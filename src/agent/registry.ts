// Agent registry. An "agent" is a named persona: a system prompt plus an
// optional tool allowlist. Brodex ships a couple of built-ins (mirroring
// opencode's build/plan) and discovers user-defined agents from
// <config>/.brodex/agents/<name>.json. The session remembers its active agent.
import { readFileSync, existsSync, readdirSync } from "node:fs"
import { resolve } from "node:path"
import type { AnyTool } from "./tool.ts"

export interface AgentDef {
  name: string
  description: string
  /** System prompt for this agent. */
  prompt: string
  /** If set, only these tool names are available to the agent. Empty/undefined = all. */
  tools?: string[]
}

const BUILD_PROMPT = `You are Brodex, an autonomous coding agent running natively inside an isolated
Linux container. Use your tools to read/write/edit files under /workspace, run
shell commands, inspect system usage, start and manage apps and services, and
install Linux packages. Operate only under /workspace for file changes. Make the
smallest change that solves the task, verify by running commands, then give a
short summary and stop.`

const PLAN_PROMPT = `You are Brodex in PLAN mode: a read-only analyst. Explore the codebase and
explain or plan changes, but do NOT modify files or run mutating commands.
Use read, glob, grep, and system inspection only. Produce a clear plan; the user
will switch you to the build agent to execute it.`

// Built-in agents.
export const BUILTIN_AGENTS: Record<string, AgentDef> = {
  build: { name: "build", description: "Full-access coding agent (default)", prompt: BUILD_PROMPT },
  plan: {
    name: "plan",
    description: "Read-only analysis & planning (no edits)",
    prompt: PLAN_PROMPT,
    tools: ["read", "glob", "grep", "system_stats", "processes"],
  },
}

const AGENTS_SUBDIR = ".brodex/agents"

/** Discover user-defined agents from <configRoot>/.brodex/agents/*.json. */
function discoverUserAgents(configRoot: string): Record<string, AgentDef> {
  const dir = resolve(configRoot, AGENTS_SUBDIR)
  if (!existsSync(dir)) return {}
  const out: Record<string, AgentDef> = {}
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue
    try {
      const raw = JSON.parse(readFileSync(resolve(dir, f), "utf8")) as Partial<AgentDef>
      const name = raw.name || f.replace(/\.json$/, "")
      if (raw.prompt) {
        out[name] = { name, description: raw.description || "(custom agent)", prompt: raw.prompt, tools: raw.tools }
      }
    } catch {
      /* skip malformed */
    }
  }
  return out
}

/** All agents available for a config root: user agents override built-ins by name. */
export function listAgents(configRoot = "/workspace"): AgentDef[] {
  const merged = { ...BUILTIN_AGENTS, ...discoverUserAgents(configRoot) }
  return Object.values(merged)
}

export function getAgent(name: string, configRoot = "/workspace"): AgentDef | undefined {
  const merged = { ...BUILTIN_AGENTS, ...discoverUserAgents(configRoot) }
  return merged[name]
}

/** Filter a tool set down to an agent's allowlist (if it has one). */
export function applyAgentTools(agent: AgentDef, tools: AnyTool[]): AnyTool[] {
  if (!agent.tools || agent.tools.length === 0) return tools
  const allow = new Set(agent.tools)
  // MCP tools (namespaced server__tool) are always allowed if their server name passes,
  // but for simplicity: allow exact matches plus any tool whose base name is allowed.
  return tools.filter((t) => allow.has(t.name) || allow.has(t.name.split("__")[0]))
}
