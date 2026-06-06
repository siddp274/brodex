#!/usr/bin/env bun
// Brodex CLI entry point (HOST side). Brodex runs on the host and drives a
// persistent Linux sandbox container via docker exec.
//
//   brodex up [--rebuild]      build (if needed) + start the persistent sandbox
//   brodex down [--rm]         stop the sandbox (volume persists); --rm removes it
//   brodex status              show whether the sandbox is running
//   brodex shell               open an interactive shell in the sandbox
//   brodex agent <prompt>      run the agent loop on a task (host loop, tools exec in sandbox)
//   brodex build               build the image only
//   brodex mount add/list/remove   manage the workspace volume
import yargs from "yargs"
import { hideBin } from "yargs/helpers"
import { spawnSync } from "node:child_process"
import { resolve } from "node:path"
import { up, down, status, shell, buildImage, BRODEX_ROOT, MOUNT_CONFIG_PATH } from "./container/launcher.ts"
import {
  loadMountConfig,
  saveMountConfig,
  addMount,
  removeMount,
  defaultContainerPath,
} from "./container/mounts.ts"

await yargs(hideBin(process.argv))
  .scriptName("brodex")
  .usage("$0 <command> [options]")
  .command(
    "up",
    "Build (if needed) and start the persistent sandbox container",
    (y) => y.option("rebuild", { type: "boolean", default: false, describe: "Rebuild the image and recreate the container" }),
    (args) => process.exit(up({ rebuild: args.rebuild })),
  )
  .command(
    "down",
    "Stop the sandbox (the host volume persists)",
    (y) => y.option("rm", { type: "boolean", default: false, describe: "Also remove the container (volume untouched)" }),
    (args) => process.exit(down(args.rm)),
  )
  .command("status", "Show whether the sandbox is running", (y) => y, () => process.exit(status()))
  .command(
    "tui",
    "Open the interactive Brodex TUI",
    (y) =>
      y
        .option("resume", { type: "string", describe: "Resume an existing thread by id" })
        .option("new", { type: "boolean", default: false, describe: "Start a fresh thread" }),
    (args) => {
      const config = loadMountConfig(MOUNT_CONFIG_PATH)
      const argv = ["run", resolve(BRODEX_ROOT, "src/tui/index.tsx")]
      if (args.resume) argv.push("--resume", args.resume as string)
      if (args.new) argv.push("--new")
      const r = spawnSync("bun", argv, {
        stdio: "inherit",
        env: { ...process.env, BRODEX_PORT: String(config.port) },
      })
      process.exit(r.status ?? 0)
    },
  )
  .command("shell", "Open an interactive shell inside the sandbox", (y) => y, () => process.exit(shell()))
  .command(
    "agent <prompt>",
    "Run the agent on a task (loop runs on host; tools exec in the sandbox)",
    (y) =>
      y
        .positional("prompt", { type: "string", demandOption: true, describe: "The task for the agent" })
        .option("resume", { type: "string", describe: "Resume an existing thread by id" })
        .option("new", { type: "boolean", default: false, describe: "Start a fresh thread instead of continuing the active one" })
        .option("mode", { type: "string", choices: ["ask", "read-only", "full"], describe: "Permission mode (default ask)" })
        .option("agent", { type: "string", describe: "Agent persona (build, plan, or a custom name)" }),
    (args) => {
      // Delegate to the agent entry point so its loop/streaming stays in one place.
      const argv = ["run", resolve(BRODEX_ROOT, "src/agent/index.ts")]
      if (args.resume) argv.push("--resume", args.resume as string)
      if (args.new) argv.push("--new")
      if (args.mode) argv.push("--mode", args.mode as string)
      if (args.agent) argv.push("--agent", args.agent as string)
      argv.push(args.prompt as string)
      const r = spawnSync("bun", argv, { stdio: "inherit" })
      process.exit(r.status ?? 0)
    },
  )
  .command(
    "sessions",
    "List saved agent threads (newest first)",
    (y) => y,
    async () => {
      const { listSessions } = await import("./agent/session.ts")
      const items = listSessions()
      if (items.length === 0) {
        console.log("brodex: no saved threads yet.")
        return
      }
      console.log("brodex threads:")
      for (const s of items) {
        const when = new Date(s.timeUpdated).toISOString().slice(0, 19).replace("T", " ")
        const tok = `${s.tokensInput}/${s.tokensOutput} tok`
        console.log(`  ${s.id}  ${when}  ${tok.padEnd(16)}  ${s.title}`)
      }
    },
  )
  .command(
    "session",
    "Manage a saved thread (rename / delete)",
    (y) =>
      y
        .command(
          "rename <id> <title>",
          "Rename a thread",
          (yy) =>
            yy
              .positional("id", { type: "string", demandOption: true })
              .positional("title", { type: "string", demandOption: true }),
          async (args) => {
            const { sessionExists, renameSession } = await import("./agent/session.ts")
            if (!sessionExists(args.id as string)) {
              console.error(`brodex: no thread "${args.id}"`)
              process.exit(1)
            }
            renameSession(args.id as string, args.title as string)
            console.log(`brodex: renamed ${args.id}`)
          },
        )
        .command(
          "delete <id>",
          "Delete a thread and its history",
          (yy) => yy.positional("id", { type: "string", demandOption: true }),
          async (args) => {
            const { sessionExists, deleteSession } = await import("./agent/session.ts")
            if (!sessionExists(args.id as string)) {
              console.error(`brodex: no thread "${args.id}"`)
              process.exit(1)
            }
            deleteSession(args.id as string)
            console.log(`brodex: deleted ${args.id}`)
          },
        )
        .demandCommand(1, "Specify: rename | delete"),
  )
  .command(
    "build",
    "Build the Brodex sandbox image",
    (y) => y,
    () => {
      const config = loadMountConfig(MOUNT_CONFIG_PATH)
      process.exit(buildImage(config.image))
    },
  )
  .command("mount", "Manage host directories mounted into the container", (y) =>
    y
      .command(
        "list",
        "List configured mounts",
        (yy) => yy,
        () => {
          const config = loadMountConfig(MOUNT_CONFIG_PATH)
          if (config.mounts.length === 0) {
            console.log("brodex: no mounts configured. Add one with `brodex mount add <path>`.")
            return
          }
          console.log(`brodex mounts (image: ${config.image}):`)
          for (const m of config.mounts) {
            console.log(`  ${m.host}  ->  ${m.container}${m.readOnly ? "  (ro)" : ""}`)
          }
        },
      )
      .command(
        "add <path>",
        "Mount a host directory into the container",
        (yy) =>
          yy
            .positional("path", { type: "string", demandOption: true, describe: "Host directory to mount" })
            .option("at", { type: "string", describe: "Container mount point (default: /workspace/<basename>)" })
            .option("ro", { type: "boolean", default: false, describe: "Mount read-only" }),
        (args) => {
          const config = loadMountConfig(MOUNT_CONFIG_PATH)
          try {
            const updated = addMount(config, args.path as string, {
              container: args.at as string | undefined,
              readOnly: args.ro,
            })
            saveMountConfig(MOUNT_CONFIG_PATH, updated)
            const at = (args.at as string | undefined) ?? defaultContainerPath(args.path as string)
            console.log(`brodex: mounted ${args.path} -> ${at}. Run \`brodex up\` to (re)start with it.`)
          } catch (e) {
            console.error(`brodex: ${(e as Error).message}`)
            process.exit(1)
          }
        },
      )
      .command(
        "remove <at>",
        "Remove a mount by its container path",
        (yy) =>
          yy.positional("at", { type: "string", demandOption: true, describe: "Container mount point to remove" }),
        (args) => {
          const config = loadMountConfig(MOUNT_CONFIG_PATH)
          const updated = removeMount(config, args.at as string)
          saveMountConfig(MOUNT_CONFIG_PATH, updated)
          console.log(`brodex: removed mount ${args.at}. Run \`brodex up\` to restart without it.`)
        },
      )
      .demandCommand(1, "Specify a mount subcommand: list | add | remove"),
  )
  .demandCommand(1, "Specify a command. Try `brodex up` or `brodex --help`.")
  .strict()
  .help()
  .parse()
