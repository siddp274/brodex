// Hooks: shell commands the user configures to run around tool calls — e.g.
// format after an edit, lint before a commit. Config lives in the workspace at
// .brodex/hooks.json. Hooks run natively in the container (the agent's
// environment). Events fire before/after specific tools in the loop.
import { readFileSync, existsSync } from "node:fs"
import { resolve } from "node:path"
import { spawnSync } from "node:child_process"

export type HookEvent = "before_shell" | "after_write" | "after_edit" | "after_run"

export interface HookConfig {
  /** Map of event -> shell commands to run when that event fires. */
  hooks: Partial<Record<HookEvent, string[]>>
}

const HOOKS_FILE = ".brodex/hooks.json"

export function loadHooks(workspaceRoot = "/workspace"): HookConfig {
  const path = resolve(workspaceRoot, HOOKS_FILE)
  if (!existsSync(path)) return { hooks: {} }
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<HookConfig>
    return { hooks: raw.hooks ?? {} }
  } catch {
    return { hooks: {} }
  }
}

export interface HookResult {
  event: HookEvent
  command: string
  code: number
  output: string
}

/**
 * Run all hooks for an event. Returns results (for surfacing in the transcript).
 * Hooks run from the workspace root. A `$BRODEX_TOOL` env var carries the tool
 * name that triggered the event.
 */
export function runHooks(event: HookEvent, ctx: { workspaceRoot: string; toolName?: string }): HookResult[] {
  const { hooks } = loadHooks(ctx.workspaceRoot)
  const commands = hooks[event] ?? []
  const results: HookResult[] = []
  for (const command of commands) {
    const r = spawnSync("bash", ["-lc", command], {
      cwd: ctx.workspaceRoot,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, BRODEX_TOOL: ctx.toolName ?? "" },
    })
    results.push({
      event,
      command,
      code: r.status ?? (r.error ? 1 : 0),
      output: ((r.stdout ?? "") + (r.stderr ?? "")).trim(),
    })
  }
  return results
}

/** Map a tool name to the event that fires AFTER it runs (if any). */
export function afterEventFor(toolName: string): HookEvent | undefined {
  if (toolName === "write") return "after_write"
  if (toolName === "edit") return "after_edit"
  return undefined
}

/** Map a tool name to the event that fires BEFORE it runs (if any). */
export function beforeEventFor(toolName: string): HookEvent | undefined {
  if (toolName === "shell") return "before_shell"
  return undefined
}
