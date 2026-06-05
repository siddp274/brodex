// Mount configuration: read/write the list of host directories that get
// bind-mounted into the Brodex container. Runs on the HOST (not in the
// container) as part of the launcher.
import { homedir } from "node:os"
import { resolve, isAbsolute } from "node:path"
import { existsSync, readFileSync, writeFileSync } from "node:fs"

export interface Mount {
  /** Host path. May start with ~ for the home directory. */
  host: string
  /** Mount point inside the container, e.g. /workspace/myproject. */
  container: string
  /** Mount read-only. Defaults to false (read-write). */
  readOnly?: boolean
}

export interface Resources {
  /** Max CPUs the container may use, e.g. 4. Maps to `docker run --cpus`. */
  cpus?: number
  /** Max memory, e.g. "8g". Maps to `docker run --memory`. */
  memory?: string
}

export interface MountConfig {
  /** Docker image tag to run. */
  image: string
  /** Container resource limits (CPU / RAM). */
  resources: Resources
  /** Port the agent server listens on inside the container (and publishes). */
  port: number
  /** Optional git repo the container clones Brodex from. If unset, local source is mounted. */
  repo?: string
  /** Git ref to clone when repo is set. */
  ref?: string
  mounts: Mount[]
}

const DEFAULT_IMAGE = "brodex:dev"
const DEFAULT_RESOURCES: Resources = { cpus: 4, memory: "8g" }
const DEFAULT_PORT = 7000

/** Expand a leading ~ to the user's home directory and make absolute. */
export function expandHostPath(p: string): string {
  let out = p
  if (out === "~") out = homedir()
  else if (out.startsWith("~/")) out = resolve(homedir(), out.slice(2))
  return isAbsolute(out) ? out : resolve(process.cwd(), out)
}

/** Derive a sensible container mount point from a host path basename. */
export function defaultContainerPath(hostPath: string): string {
  const expanded = expandHostPath(hostPath)
  const base = expanded.split("/").filter(Boolean).pop() ?? "dir"
  return `/workspace/${base}`
}

export function loadMountConfig(configPath: string): MountConfig {
  if (!existsSync(configPath)) {
    return { image: DEFAULT_IMAGE, resources: { ...DEFAULT_RESOURCES }, port: DEFAULT_PORT, mounts: [] }
  }
  const raw = JSON.parse(readFileSync(configPath, "utf8")) as Partial<MountConfig>
  return {
    image: raw.image ?? DEFAULT_IMAGE,
    resources: { ...DEFAULT_RESOURCES, ...(raw.resources ?? {}) },
    port: raw.port ?? DEFAULT_PORT,
    repo: raw.repo,
    ref: raw.ref,
    mounts: Array.isArray(raw.mounts) ? raw.mounts : [],
  }
}

export function saveMountConfig(configPath: string, config: MountConfig): void {
  const out = {
    $comment:
      "Host directories Brodex bind-mounts into the container. Edit by hand or with `brodex mount add <hostPath>`. Changes take effect on the next restart.",
    image: config.image,
    resources: config.resources,
    port: config.port,
    ...(config.repo ? { repo: config.repo, ref: config.ref ?? "main" } : {}),
    mounts: config.mounts,
  }
  writeFileSync(configPath, JSON.stringify(out, null, 2) + "\n", "utf8")
}

/**
 * Build the `--cpus` / `--memory` arguments for `docker run` from the resource
 * config. Skips any unset value so Docker falls back to its own defaults.
 */
export function toDockerResourceArgs(resources: Resources): string[] {
  const args: string[] = []
  if (resources.cpus != null) args.push("--cpus", String(resources.cpus))
  if (resources.memory != null) args.push("--memory", resources.memory)
  return args
}

/**
 * Add a mount, validating the host path exists and avoiding duplicate
 * container mount points. Returns the updated config (does not save).
 */
export function addMount(
  config: MountConfig,
  hostPath: string,
  opts: { container?: string; readOnly?: boolean } = {},
): MountConfig {
  const expanded = expandHostPath(hostPath)
  if (!existsSync(expanded)) {
    throw new Error(`host path does not exist: ${expanded}`)
  }
  const container = opts.container ?? defaultContainerPath(hostPath)

  if (config.mounts.some((m) => m.container === container)) {
    throw new Error(`a mount already targets ${container}; pass an explicit --at to disambiguate`)
  }

  return {
    ...config,
    mounts: [
      ...config.mounts,
      { host: hostPath, container, readOnly: opts.readOnly ?? false },
    ],
  }
}

/** Remove a mount by its container path. Returns the updated config. */
export function removeMount(config: MountConfig, containerPath: string): MountConfig {
  return {
    ...config,
    mounts: config.mounts.filter((m) => m.container !== containerPath),
  }
}

/**
 * Build the `-v host:container[:ro]` arguments for `docker run`, expanding ~ and
 * relative host paths to absolute. Throws if a host path is missing so we fail
 * before launching rather than silently mounting an empty dir.
 */
export function toDockerVolumeArgs(config: MountConfig): string[] {
  const args: string[] = []
  for (const m of config.mounts) {
    const host = expandHostPath(m.host)
    if (!existsSync(host)) {
      throw new Error(`configured mount host path is missing: ${host} (from "${m.host}")`)
    }
    const ro = m.readOnly ? ":ro" : ""
    args.push("-v", `${host}:${m.container}${ro}`)
  }
  return args
}
