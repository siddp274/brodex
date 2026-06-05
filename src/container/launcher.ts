// Host-side container lifecycle manager. Brodex runs on the host; this module
// builds the image and manages a PERSISTENT, named container that Brodex drives
// via `docker exec` (see exec.ts). The container and its volume persist across
// agent turns and sessions until explicitly stopped.
import { spawnSync } from "node:child_process"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { existsSync } from "node:fs"
import {
  loadMountConfig,
  toDockerVolumeArgs,
  toDockerResourceArgs,
  type MountConfig,
} from "./mounts.ts"

const HERE = dirname(fileURLToPath(import.meta.url))
export const BRODEX_ROOT = resolve(HERE, "..", "..")
export const MOUNT_CONFIG_PATH = resolve(BRODEX_ROOT, "config", "brodex.mounts.json")
const ENV_PATH = resolve(BRODEX_ROOT, ".env")

/** Name of the persistent container Brodex manages. */
export const CONTAINER_NAME = "brodex-sandbox"

export function checkDocker(): { ok: boolean; message?: string } {
  const which = spawnSync("docker", ["--version"], { encoding: "utf8" })
  if (which.status !== 0) {
    return { ok: false, message: "Docker CLI not found. Install Docker Desktop and ensure `docker` is on PATH." }
  }
  const info = spawnSync("docker", ["info"], { encoding: "utf8", stdio: "ignore" })
  if (info.status !== 0) {
    return { ok: false, message: "Docker daemon not reachable. Is Docker Desktop running?" }
  }
  return { ok: true }
}

export function buildImage(image: string): number {
  console.error(`brodex: building image ${image} ...`)
  const r = spawnSync(
    "docker",
    ["build", "-t", image, "-f", resolve(BRODEX_ROOT, "Dockerfile"), BRODEX_ROOT],
    { stdio: "inherit" },
  )
  return r.status ?? 1
}

export function imageExists(image: string): boolean {
  const r = spawnSync("docker", ["image", "inspect", image], { stdio: "ignore" })
  return r.status === 0
}

/** Container state: "running", "exited", or "absent". */
export function containerState(): "running" | "exited" | "absent" {
  const r = spawnSync(
    "docker",
    ["inspect", "-f", "{{.State.Running}}", CONTAINER_NAME],
    { encoding: "utf8" },
  )
  if (r.status !== 0) return "absent"
  return r.stdout.trim() === "true" ? "running" : "exited"
}

interface UpOptions {
  rebuild?: boolean
}

/**
 * Bring up the persistent sandbox container (detached) with the configured
 * volume + resource limits and provider keys from .env. Idempotent: if the
 * container is already running, this is a no-op; if it exists but is stopped, it
 * is started; otherwise it is created. The container and volume persist.
 */
export function up(opts: UpOptions = {}): number {
  const docker = checkDocker()
  if (!docker.ok) {
    console.error(`brodex: ${docker.message}`)
    return 1
  }

  const config = loadMountConfig(MOUNT_CONFIG_PATH)

  if (opts.rebuild) {
    // A rebuild implies recreating the container from the new image.
    if (containerState() !== "absent") down(true)
    const code = buildImage(config.image)
    if (code !== 0) return code
  } else if (!imageExists(config.image)) {
    const code = buildImage(config.image)
    if (code !== 0) return code
  }

  const state = containerState()
  if (state === "running") {
    console.error(`brodex: sandbox already running (${CONTAINER_NAME}).`)
    return 0
  }
  if (state === "exited") {
    const r = spawnSync("docker", ["start", CONTAINER_NAME], { stdio: "inherit" })
    if (r.status === 0) console.error(`brodex: started existing sandbox (${CONTAINER_NAME}).`)
    return r.status ?? 0
  }

  // Create fresh.
  let volumeArgs: string[]
  try {
    volumeArgs = toDockerVolumeArgs(config)
  } catch (e) {
    console.error(`brodex: ${(e as Error).message}`)
    return 1
  }

  const args: string[] = [
    "run",
    "-d", // detached: the agent server runs for the life of the container
    "--name",
    CONTAINER_NAME,
    ...toDockerResourceArgs(config.resources),
    // Publish the agent server's port to the host so clients can connect.
    "-p",
    `${config.port}:${config.port}`,
    "-e",
    `BRODEX_PORT=${config.port}`,
    ...volumeArgs,
    "--security-opt",
    "no-new-privileges:true",
  ]

  // Code source: clone from repo if configured, else mount local source as a
  // dev fallback at /brodex (the entrypoint detects which).
  if (config.repo) {
    args.push("-e", `BRODEX_REPO=${config.repo}`, "-e", `BRODEX_REF=${config.ref ?? "main"}`)
  } else {
    args.push("-v", `${BRODEX_ROOT}:/brodex:ro`)
  }

  if (existsSync(ENV_PATH)) {
    args.push("--env-file", ENV_PATH)
  }
  args.push(config.image)

  if (config.mounts.length === 0) {
    console.error("brodex: warning — no workspace volume mounted. Add one with `brodex mount add <path> --at /workspace`.")
  }

  const r = spawnSync("docker", args, { stdio: "inherit" })
  if (r.status === 0) {
    const limits = [
      config.resources.cpus != null ? `${config.resources.cpus} CPU` : null,
      config.resources.memory != null ? `${config.resources.memory} RAM` : null,
    ].filter(Boolean).join(", ")
    console.error(`brodex: agent server up (${CONTAINER_NAME}, port ${config.port}${limits ? ", " + limits : ""}).`)
    console.error(`brodex: connect with  brodex tui`)
  }
  return r.status ?? 0
}

/** Stop the sandbox. With remove=true, also delete the container (volume persists). */
export function down(remove = false): number {
  const state = containerState()
  if (state === "absent") {
    console.error("brodex: no sandbox container to stop.")
    return 0
  }
  if (state === "running") {
    spawnSync("docker", ["stop", CONTAINER_NAME], { stdio: "inherit" })
  }
  if (remove) {
    spawnSync("docker", ["rm", CONTAINER_NAME], { stdio: "ignore" })
    console.error(`brodex: sandbox removed (${CONTAINER_NAME}). The host volume is untouched.`)
  } else {
    console.error(`brodex: sandbox stopped (${CONTAINER_NAME}). State persists; \`brodex up\` resumes it.`)
  }
  return 0
}

/** Print a short status line for the sandbox. */
export function status(): number {
  const docker = checkDocker()
  if (!docker.ok) {
    console.error(`brodex: ${docker.message}`)
    return 1
  }
  const state = containerState()
  console.log(`brodex sandbox (${CONTAINER_NAME}): ${state}`)
  return 0
}

/** Open an interactive shell inside the running sandbox (convenience). */
export function shell(): number {
  if (containerState() !== "running") {
    console.error("brodex: sandbox is not running. Start it with `brodex up`.")
    return 1
  }
  const r = spawnSync("docker", ["exec", "-it", CONTAINER_NAME, "/bin/bash"], { stdio: "inherit" })
  return r.status ?? 0
}
