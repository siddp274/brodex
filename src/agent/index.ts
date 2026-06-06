#!/usr/bin/env bun
// Brodex agent entry point — runs on the HOST. The agent loop and LLM calls
// happen here; every tool executes inside the persistent sandbox container via
// docker exec. The container must already be up (`brodex up`).
//
// Sessions: each run belongs to a thread whose history is persisted host-side.
// The thread id is printed so you can resume later with --resume <id>.
//
// Usage:
//   bun run src/agent/index.ts [--resume <thread-id>] <prompt>
import { loadEnv } from "./env.ts"
import { run, type LoopEvent } from "./loop.ts"
import { buildTools } from "./tools/all.ts"
import { createProviderFromEnv } from "./provider.ts"
import { type Mode, SessionGrants } from "./permission.ts"
import { terminalApprover } from "./approver-terminal.ts"
import { withMemory } from "./memory.ts"
import { effectiveConfigRoot } from "./config-scope.ts"
import { getAgent, applyAgentTools } from "./registry.ts"

// Load brodex/.env into process.env before anything reads provider keys.
loadEnv()
import { containerState } from "../container/launcher.ts"
import {
  createSession,
  getSession,
  sessionExists,
  loadMessages,
  persistMessages,
  touchSession,
  getActiveThreadId,
  setActiveThreadId,
  type SessionInfo,
} from "./session.ts"

const SYSTEM_PROMPT = `You are Brodex, an autonomous coding agent. You orchestrate work inside an
isolated Linux sandbox container. Every tool you call runs in that container:
you can read/write/edit files under /workspace, search and run shell commands,
inspect system usage, start and manage apps and services, and install Linux
packages. Operate only under /workspace for file changes. Think step by step,
make the smallest change that solves the task, and verify by running commands.
When the task is complete, give a short summary and stop.`

const WORKSPACE_ROOT = "/workspace" // inside the container

function render(e: LoopEvent): void {
  switch (e.type) {
    case "assistant_text":
      process.stdout.write(`\n${e.text}\n`)
      break
    case "tool_call":
      process.stdout.write(`\n  → ${e.toolName}(${truncate(e.toolArgs ?? "", 200)})\n`)
      break
    case "tool_result":
      process.stdout.write(`    ${truncate((e.toolResult ?? "").replace(/\n/g, "\n    "), 600)}\n`)
      break
    case "done":
      process.stdout.write(`\n[done]\n`)
      break
    case "denied":
      process.stdout.write(`    ⛔ ${e.toolName}: ${e.toolResult}\n`)
      break
    case "error":
      process.stderr.write(`\n[error] ${e.text}\n`)
      break
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s
}

/** Parse --resume <id> / --new / --mode <m> out of argv; the rest is the prompt. */
function parseArgs(argv: string[]): { resume?: string; fresh: boolean; mode: Mode; cwd?: string; agentName?: string; prompt: string } {
  const rest: string[] = []
  let resume: string | undefined
  let fresh = false
  let mode: Mode = "ask"
  let cwd: string | undefined
  let agentName: string | undefined
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--resume") {
      resume = argv[++i]
    } else if (argv[i] === "--new") {
      fresh = true
    } else if (argv[i] === "--mode") {
      const m = argv[++i]
      if (m === "ask" || m === "read-only" || m === "full") mode = m
    } else if (argv[i] === "--cwd") {
      cwd = argv[++i]
    } else if (argv[i] === "--agent") {
      agentName = argv[++i]
    } else {
      rest.push(argv[i])
    }
  }
  return { resume, fresh, mode, cwd, agentName, prompt: rest.join(" ").trim() }
}

async function main() {
  const { resume, fresh, mode, cwd: cwdArg, agentName, prompt } = parseArgs(process.argv.slice(2))
  if (!prompt) {
    process.stderr.write("usage: bun run src/agent/index.ts [--resume <id> | --new] [--mode ask|read-only|full] <prompt>\n")
    process.exit(2)
  }

  if (containerState() !== "running") {
    process.stderr.write("brodex: sandbox is not running. Start it first with `brodex up`.\n")
    process.exit(1)
  }

  const cwd = cwdArg && cwdArg.startsWith(WORKSPACE_ROOT) ? cwdArg : WORKSPACE_ROOT
  const configRoot = effectiveConfigRoot({ root: WORKSPACE_ROOT, cwd })
  const agentDef = getAgent(agentName ?? "build", configRoot) ?? getAgent("build", configRoot)!

  // Thread selection:
  //   --resume <id>  -> that thread
  //   --new          -> a fresh thread
  //   (default)      -> continue the active thread, or start fresh if none
  let session: SessionInfo
  if (resume) {
    if (!sessionExists(resume)) {
      process.stderr.write(`brodex: no thread with id "${resume}".\n`)
      process.exit(1)
    }
    session = getSession(resume)!
    process.stderr.write(`brodex: resuming thread ${session.id}\n`)
  } else if (!fresh && getActiveThreadId()) {
    session = getSession(getActiveThreadId()!)!
    process.stderr.write(`brodex: continuing active thread ${session.id}\n`)
  } else {
    session = createSession(prompt, undefined, cwd, agentDef.name)
    process.stderr.write(`brodex: new thread ${session.id}\n`)
  }
  // Mark this thread active so the next run continues it by default.
  setActiveThreadId(session.id)
  process.stderr.write(`brodex: (resume explicitly with  brodex agent --resume ${session.id} "<prompt>" ; start fresh with --new)\n`)

  process.stderr.write(`brodex: permission mode = ${mode}, cwd = ${cwd}\n`)

  const history = loadMessages(session.id)
  const provider = createProviderFromEnv()
  await run({
    provider,
    tools: applyAgentTools(agentDef, buildTools(configRoot)),
    system: withMemory(agentDef.prompt, configRoot).prompt,
    prompt,
    history,
    ctx: { workspaceRoot: cwd },
    mode,
    grants: new SessionGrants(),
    approver: terminalApprover,
    onEvent: render,
    onPersist: (messages) => persistMessages(session.id, messages),
    onUsage: (u) => touchSession(session.id, { tokensInput: u.inputTokens, tokensOutput: u.outputTokens }),
  })

  const final = getSession(session.id)
  if (final) {
    process.stderr.write(`\nbrodex: thread ${session.id} saved. tokens: ${final.tokensInput} in / ${final.tokensOutput} out\n`)
  }
}

main().catch((e) => {
  process.stderr.write(`brodex agent: ${(e as Error).message}\n`)
  process.exit(1)
})
