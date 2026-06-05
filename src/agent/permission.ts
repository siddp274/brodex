// Permission model, mirroring opencode's allow/ask/deny design but kept
// framework-free. This is the INNER gate: the container is the outer sandbox
// (the agent can't escape it and can never reach host files), while this decides
// what the agent may do to the mounted /workspace and the container WITHOUT
// asking the user first.
import type { AnyTool } from "./tool.ts"

/** Per-call effect, as in opencode. */
export type Effect = "allow" | "ask" | "deny"

/** The permission modes the user switches between. */
export type Mode = "ask" | "read-only" | "full"

/** What the user (or terminal/TUI) decides when asked. */
export type Decision = "allow-once" | "allow-session" | "deny"

/**
 * Tool classification. Read tools only observe; mutate tools change files, run
 * commands, install packages, or start processes in the container.
 */
const READ_TOOLS = new Set(["read", "glob", "grep", "system_stats", "processes"])
const MUTATE_TOOLS = new Set(["write", "edit", "shell", "install_packages", "run_app"])

export function isReadTool(name: string): boolean {
  return READ_TOOLS.has(name)
}
export function isMutateTool(name: string): boolean {
  // Anything not explicitly a read tool is treated as mutating (safe default).
  return MUTATE_TOOLS.has(name) || !READ_TOOLS.has(name)
}

/**
 * Base effect for a tool under a given mode, before session grants:
 *
 *   ask        — reads ASK, writes ASK              (default; nothing runs unprompted)
 *   read-only  — reads ASK, writes DENY             (explore/plan only)
 *   full       — everything ALLOW                   (no prompts)
 */
export function baseEffect(toolName: string, mode: Mode): Effect {
  if (mode === "full") return "allow"
  if (mode === "read-only") return isReadTool(toolName) ? "ask" : "deny"
  // mode === "ask": everything asks (including reads, per design).
  return "ask"
}

/** Tracks which tools the user has allowed for the rest of the session. */
export class SessionGrants {
  private allowed = new Set<string>()

  grant(toolName: string): void {
    this.allowed.add(toolName)
  }
  has(toolName: string): boolean {
    return this.allowed.has(toolName)
  }
  clear(): void {
    this.allowed.clear()
  }
}

/**
 * Resolve the effective decision for a tool call. Session grants upgrade an
 * "ask" to "allow"; "deny" is never overridden by a grant.
 */
export function resolveEffect(toolName: string, mode: Mode, grants: SessionGrants): Effect {
  const base = baseEffect(toolName, mode)
  if (base === "ask" && grants.has(toolName)) return "allow"
  return base
}

/**
 * An approver is asked when a call resolves to "ask". It returns the user's
 * decision. Injected by the host (terminal) or the TUI (dialog).
 */
export type Approver = (req: {
  toolName: string
  args: string
  mode: Mode
}) => Promise<Decision>
