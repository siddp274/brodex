// Container-capability tools. Beyond editing files, the agent can inspect the
// container's live Linux state, manage processes/apps, and install packages.
// The agent runs natively inside the container, so these are local shell calls.
import { z } from "zod"
import { spawnSync } from "node:child_process"
import { defineTool, type AnyTool } from "../tool.ts"

interface ShResult {
  stdout: string
  stderr: string
  code: number
}

/** Run a shell command locally (inside the container) and capture output. */
function sh(command: string, cwd?: string): ShResult {
  const r = spawnSync("bash", ["-lc", command], {
    cwd,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  })
  return {
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
    code: r.status ?? (r.error ? 1 : 0),
  }
}

const sysstat = defineTool({
  name: "system_stats",
  description:
    "Report the sandbox container's system usage: CPU/memory (from /proc and free), disk usage (df), and top processes. Use to understand resource pressure before/while running heavy work.",
  parameters: z.object({
    what: z
      .enum(["all", "cpu", "memory", "disk", "processes"])
      .optional()
      .describe("Which stats to report (default: all)"),
  }),
  async execute(args) {
    const what = args.what ?? "all"
    const parts: string[] = []
    const add = (label: string, cmd: string) => {
      const r = sh(cmd)
      parts.push(`### ${label}\n${(r.stdout + r.stderr).trim() || "(no output)"}`)
    }
    if (what === "all" || what === "memory") add("Memory", "free -h")
    if (what === "all" || what === "cpu")
      add("CPU / load", "uptime; echo; grep -c ^processor /proc/cpuinfo | sed 's/^/cores: /'")
    if (what === "all" || what === "disk") add("Disk", "df -h /workspace /")
    if (what === "all" || what === "processes")
      add("Top processes", "ps -eo pid,pcpu,pmem,comm --sort=-pcpu | head -n 12")
    return parts.join("\n\n")
  },
})

const processes = defineTool({
  name: "processes",
  description:
    "List or signal processes inside the sandbox. action=list shows running processes; action=kill sends a signal to a PID. Use to manage apps/services the agent started.",
  parameters: z.object({
    action: z.enum(["list", "kill"]).describe("list processes, or kill one"),
    pid: z.number().optional().describe("PID to signal (required for kill)"),
    signal: z.string().optional().describe("Signal name/number for kill (default TERM)"),
  }),
  async execute(args) {
    if (args.action === "list") {
      const r = sh("ps -eo pid,ppid,pcpu,pmem,etime,comm --sort=-pcpu | head -n 30")
      return (r.stdout + r.stderr).trim() || "(no processes)"
    }
    if (args.pid == null) return "error: kill requires a pid"
    const sig = args.signal ?? "TERM"
    const r = sh(`kill -${shqArg(sig)} ${args.pid}`)
    return r.code === 0 ? `sent SIG${sig} to pid ${args.pid}` : `error: ${r.stderr.trim()}`
  },
})

const service = defineTool({
  name: "run_app",
  description:
    "Start a long-running application or service inside the sandbox (detached), or check on one. action=start launches a command in the background and returns its PID; action=logs tails a started app's output; action=status checks if a PID is alive. Apps persist while the sandbox is up.",
  parameters: z.object({
    action: z.enum(["start", "logs", "status"]).describe("start an app, read its logs, or check status"),
    command: z.string().optional().describe("Command to start (required for start)"),
    name: z
      .string()
      .optional()
      .describe("A short name to label the app's log file (required for start/logs)"),
    pid: z.number().optional().describe("PID to check (required for status)"),
  }),
  async execute(args) {
    const logDir = "/tmp/brodex-apps"
    if (args.action === "start") {
      if (!args.command || !args.name) return "error: start requires command and name"
      const log = `${logDir}/${sanitize(args.name)}.log`
      // Launch detached with nohup; capture PID.
      const cmd =
        `mkdir -p ${logDir} && nohup bash -lc ${shq(args.command)} >${log} 2>&1 & echo "pid=$!"`
      const r = sh(cmd, "/workspace")
      return r.code === 0
        ? `started "${args.name}" (${r.stdout.trim()}), logs at ${log}`
        : `error: ${r.stderr.trim()}`
    }
    if (args.action === "logs") {
      if (!args.name) return "error: logs requires name"
      const log = `${logDir}/${sanitize(args.name)}.log`
      const r = sh(`tail -n 100 ${shq(log)}`)
      return (r.stdout + r.stderr).trim() || "(no logs yet)"
    }
    // status
    if (args.pid == null) return "error: status requires a pid"
    const r = sh(`kill -0 ${args.pid} 2>/dev/null && echo alive || echo dead`)
    return r.stdout.trim() || "unknown"
  },
})

const pkg = defineTool({
  name: "install_packages",
  description:
    "Install Linux packages into the sandbox with apt-get so the agent gains new native tools. Use sparingly and only for tools the task needs. Returns the install output.",
  parameters: z.object({
    packages: z.array(z.string()).describe("Package names to install, e.g. ['python3','make']"),
  }),
  async execute(args) {
    if (args.packages.length === 0) return "error: no packages specified"
    const list = args.packages.map(shq).join(" ")
    const cmd = `apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ${list}`
    const r = sh(cmd)
    const out = (r.stdout + r.stderr).trim()
    return r.code === 0 ? `installed: ${args.packages.join(", ")}\n${tail(out, 20)}` : `error: ${tail(out, 30)}`
  },
})

function shq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}
function shqArg(s: string): string {
  return /^[A-Za-z0-9]+$/.test(s) ? s : shq(s)
}
function sanitize(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]/g, "_")
}
function tail(s: string, n: number): string {
  const lines = s.split("\n")
  return lines.slice(-n).join("\n")
}

export const SYSTEM_TOOLS: AnyTool[] = [sysstat, processes, service, pkg]
