#!/usr/bin/env bun
// Brodex agent server — runs INSIDE the container as the long-lived process.
// Exposes HTTP (session/prompt/mode management) + WebSocket (live run streaming
// and the approval round-trip). Clients (TUI now; phone/web later) connect over
// the published port. Tools run natively in the container.
import { loadEnv } from "../agent/env.ts"
loadEnv()

import { run, type LoopEvent } from "../agent/loop.ts"
import { buildTools } from "../agent/tools/all.ts"
import { createProviderFromEnv } from "../agent/provider.ts"
import { type Mode, type Decision, SessionGrants } from "../agent/permission.ts"
import {
  createSession,
  getSession,
  sessionExists,
  loadMessages,
  persistMessages,
  touchSession,
  renameSession,
  deleteSession,
  setSessionCwd,
  listSessions,
  getActiveThreadId,
  setActiveThreadId,
} from "../agent/session.ts"
import { searchFiles } from "../agent/file-search.ts"
import { withMemory } from "../agent/memory.ts"
import { connectMcpServers, type McpConnection } from "../agent/mcp.ts"
import { effectiveConfigRoot } from "../agent/config-scope.ts"
import type { ServerMessage, ClientMessage } from "./protocol.ts"
import { WS_PATH } from "./protocol.ts"
import { readdirSync, mkdirSync, existsSync } from "node:fs"
import { resolve as pathResolve } from "node:path"

const PORT = Number(process.env.BRODEX_PORT ?? 7000)
const AUTH_TOKEN = process.env.BRODEX_AUTH_TOKEN // optional; enforced only if set
const WORKSPACE_ROOT = process.env.BRODEX_WORKSPACE ?? "/workspace"

// MCP connections are cached per effective config root (workspace or project),
// so per-project MCP servers work and we don't reconnect every run.
const mcpCache = new Map<string, McpConnection[]>()
async function mcpToolsFor(configRoot: string): Promise<import("../agent/tool.ts").AnyTool[]> {
  let conns = mcpCache.get(configRoot)
  if (!conns) {
    conns = await connectMcpServers(configRoot)
    mcpCache.set(configRoot, conns)
    if (conns.length) process.stderr.write(`brodex-agent: connected ${conns.length} MCP server(s) for ${configRoot}\n`)
  }
  return conns.flatMap((c) => c.tools)
}

const SYSTEM_PROMPT = `You are Brodex, an autonomous coding agent running natively inside an isolated
Linux container. Use your tools to read/write/edit files under /workspace, run
shell commands, inspect system usage, start and manage apps and services, and
install Linux packages. Operate only under /workspace for file changes. Make the
smallest change that solves the task, verify by running commands, then give a
short summary and stop.`

// ---- connection + approval bookkeeping -------------------------------------

type WS = { send: (data: string) => void; data: { id: string } }
const sockets = new Set<WS>()
let grants = new SessionGrants() // simple single-user session-wide grants
const pendingApprovals = new Map<string, (d: Decision) => void>()

function broadcast(msg: ServerMessage): void {
  const data = JSON.stringify(msg)
  for (const ws of sockets) {
    try {
      ws.send(data)
    } catch {
      /* dropped socket */
    }
  }
}

/** Approver that asks connected clients over WS and waits for a response. */
function wsApprover(sessionId: string) {
  return (req: { toolName: string; args: string; mode: Mode }) =>
    new Promise<Decision>((resolve) => {
      const requestId = crypto.randomUUID()
      pendingApprovals.set(requestId, resolve)
      broadcast({
        type: "approval_request",
        sessionId,
        requestId,
        toolName: req.toolName,
        args: req.args,
        mode: req.mode,
      })
      // If no client is connected, deny after a short grace period so the run
      // doesn't hang forever.
      if (sockets.size === 0) {
        pendingApprovals.delete(requestId)
        resolve("deny")
      }
    })
}

// ---- run management ---------------------------------------------------------

let activeRun: Promise<unknown> | null = null

async function startRun(sessionId: string, prompt: string, mode: Mode): Promise<void> {
  if (activeRun) await activeRun.catch(() => {})
  const provider = createProviderFromEnv()
  broadcast({ type: "run_started", sessionId })

  // Resolve per-project scope: the session's cwd (a project dir or the root)
  // determines where tools operate and which .brodex config applies.
  const session = getSession(sessionId)
  const cwd = session?.cwd ?? WORKSPACE_ROOT
  const configRoot = effectiveConfigRoot({ root: WORKSPACE_ROOT, cwd })
  const mcpTools = await mcpToolsFor(configRoot)

  const onEvent = (e: LoopEvent) => {
    switch (e.type) {
      case "assistant_text":
        broadcast({ type: "assistant_text", sessionId, text: e.text ?? "" })
        break
      case "tool_call":
        broadcast({ type: "tool_call", sessionId, toolName: e.toolName ?? "", args: e.toolArgs ?? "" })
        break
      case "tool_result":
        broadcast({ type: "tool_result", sessionId, toolName: e.toolName ?? "", result: e.toolResult ?? "" })
        break
      case "denied":
        broadcast({ type: "denied", sessionId, toolName: e.toolName ?? "", detail: e.toolResult ?? "" })
        break
      case "done":
        broadcast({ type: "run_done", sessionId })
        break
      case "error":
        broadcast({ type: "run_error", sessionId, error: e.text ?? "unknown error" })
        break
    }
  }

  const history = loadMessages(sessionId)
  activeRun = run({
    provider,
    tools: [...buildTools(configRoot), ...mcpTools],
    system: withMemory(SYSTEM_PROMPT, configRoot).prompt,
    prompt,
    history,
    ctx: { workspaceRoot: cwd },
    mode,
    grants,
    approver: wsApprover(sessionId),
    onEvent,
    onPersist: (messages) => persistMessages(sessionId, messages),
    onUsage: (u) => {
      touchSession(sessionId, { tokensInput: u.inputTokens, tokensOutput: u.outputTokens })
      broadcast({ type: "usage", sessionId, inputTokens: u.inputTokens, outputTokens: u.outputTokens })
    },
  })
  try {
    await activeRun
  } catch (e) {
    broadcast({ type: "run_error", sessionId, error: (e as Error).message })
  } finally {
    activeRun = null
  }
}

// ---- HTTP helpers -----------------------------------------------------------

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

function authed(req: Request): boolean {
  if (!AUTH_TOKEN) return true // local: no auth
  const header = req.headers.get("authorization") ?? ""
  return header === `Bearer ${AUTH_TOKEN}`
}

// ---- server -----------------------------------------------------------------

const server = Bun.serve<{ id: string }>({
  port: PORT,
  async fetch(req, srv) {
    const url = new URL(req.url)

    // WebSocket upgrade.
    if (url.pathname === WS_PATH) {
      if (srv.upgrade(req, { data: { id: crypto.randomUUID() } })) return undefined as unknown as Response
      return new Response("websocket upgrade failed", { status: 400 })
    }

    if (!authed(req)) return json({ error: "unauthorized" }, 401)

    // Routes.
    const m = (method: string, path: RegExp) => req.method === method && path.test(url.pathname)
    const seg = url.pathname.split("/").filter(Boolean)

    if (m("GET", /^\/health$/)) return json({ ok: true })

    if (m("GET", /^\/sessions$/)) {
      return json({ sessions: listSessions(), activeId: getActiveThreadId() })
    }

    if (m("POST", /^\/session$/)) {
      const body = (await req.json().catch(() => ({}))) as { title?: string; cwd?: string }
      const cwd = body.cwd && body.cwd.startsWith(WORKSPACE_ROOT) ? body.cwd : WORKSPACE_ROOT
      const s = createSession(body.title ?? "New session", undefined, cwd)
      setActiveThreadId(s.id)
      return json({ id: s.id, title: s.title, cwd: s.cwd })
    }

    // /session/:id ...
    if (seg[0] === "session" && seg[1]) {
      const id = seg[1]
      if (!sessionExists(id)) return json({ error: "no such session" }, 404)

      if (m("GET", /^\/session\/[^/]+\/messages$/)) {
        return json({ messages: loadMessages(id) })
      }
      if (m("POST", /^\/session\/[^/]+\/prompt$/)) {
        const body = (await req.json()) as { prompt: string; mode?: Mode }
        if (!body.prompt?.trim()) return json({ error: "empty prompt" }, 400)
        setActiveThreadId(id)
        // Fire the run; stream goes over WS. Respond immediately.
        void startRun(id, body.prompt, body.mode ?? "ask")
        return json({ ok: true })
      }
      if (m("POST", /^\/session\/[^/]+\/mode$/)) {
        // Mode is per-run here; accept and store nothing persistent for now.
        return json({ ok: true })
      }
      if (m("POST", /^\/session\/[^/]+\/cwd$/)) {
        const body = (await req.json()) as { cwd: string }
        const cwd = body.cwd && body.cwd.startsWith(WORKSPACE_ROOT) ? body.cwd : WORKSPACE_ROOT
        setSessionCwd(id, cwd)
        return json({ ok: true, cwd })
      }
      if (m("PATCH", /^\/session\/[^/]+$/)) {
        const body = (await req.json()) as { title: string }
        renameSession(id, body.title)
        return json({ ok: true })
      }
      if (m("DELETE", /^\/session\/[^/]+$/)) {
        deleteSession(id)
        return json({ ok: true })
      }
    }

    if (m("GET", /^\/projects$/)) {
      const dirs = existsSync(WORKSPACE_ROOT)
        ? readdirSync(WORKSPACE_ROOT, { withFileTypes: true })
            .filter((e) => e.isDirectory() && !e.name.startsWith("."))
            .map((e) => e.name)
        : []
      return json({ root: WORKSPACE_ROOT, projects: dirs })
    }
    if (m("POST", /^\/projects$/)) {
      const body = (await req.json()) as { name: string }
      const name = (body.name ?? "").replace(/[^A-Za-z0-9._-]/g, "")
      if (!name) return json({ error: "invalid project name" }, 400)
      const dir = pathResolve(WORKSPACE_ROOT, name)
      mkdirSync(dir, { recursive: true })
      return json({ ok: true, dir, name })
    }
    if (m("GET", /^\/files$/)) {
      const q = url.searchParams.get("q") ?? ""
      return json({ files: searchFiles(q, 8, WORKSPACE_ROOT) })
    }

    return json({ error: "not found" }, 404)
  },
  websocket: {
    open(ws) {
      sockets.add(ws as unknown as WS)
      ;(ws as unknown as WS).send(JSON.stringify({ type: "hello", activeId: getActiveThreadId() } satisfies ServerMessage))
    },
    close(ws) {
      sockets.delete(ws as unknown as WS)
    },
    message(ws, raw) {
      let msg: ClientMessage
      try {
        msg = JSON.parse(String(raw))
      } catch {
        return
      }
      if (msg.type === "approval_response") {
        const resolve = pendingApprovals.get(msg.requestId)
        if (resolve) {
          pendingApprovals.delete(msg.requestId)
          resolve(msg.decision)
        }
      }
      // "subscribe" is a no-op for now (single broadcast channel).
    },
  },
})

process.stderr.write(`brodex-agent: listening on http://0.0.0.0:${server.port}  (ws ${WS_PATH})\n`)
