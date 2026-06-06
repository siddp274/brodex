// Host-side API client for the in-container agent server. The TUI uses this
// instead of importing the agent loop directly: HTTP for session/prompt/mode
// management, WebSocket for live run events and the approval round-trip.
import type {
  ServerMessage,
  ClientMessage,
  SessionSummary,
  ListSessionsResponse,
  CreateSessionResponse,
  MessagesResponse,
} from "../server/protocol.ts"
import { WS_PATH } from "../server/protocol.ts"
import type { Mode, Decision } from "../agent/permission.ts"
import type { Message } from "../agent/types.ts"

export interface ApiConfig {
  host: string // e.g. "localhost"
  port: number
  token?: string // bearer token, if the server requires it
}

export class BrodexClient {
  private base: string
  private headers: Record<string, string>
  private ws: WebSocket | null = null
  private handlers = new Set<(m: ServerMessage) => void>()

  constructor(private config: ApiConfig) {
    this.base = `http://${config.host}:${config.port}`
    this.headers = { "content-type": "application/json" }
    if (config.token) this.headers.authorization = `Bearer ${config.token}`
  }

  // ---- HTTP -----------------------------------------------------------------

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(this.base + path, {
      method,
      headers: this.headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`${method} ${path} -> HTTP ${res.status}`)
    return (await res.json()) as T
  }

  health(): Promise<{ ok: boolean }> {
    return this.req("GET", "/health")
  }
  listSessions(): Promise<ListSessionsResponse> {
    return this.req("GET", "/sessions")
  }
  createSession(title?: string, cwd?: string): Promise<CreateSessionResponse> {
    return this.req("POST", "/session", { title, cwd })
  }
  listProjects(): Promise<{ root: string; projects: string[] }> {
    return this.req("GET", "/projects")
  }
  createProject(name: string): Promise<{ ok: boolean; dir: string; name: string }> {
    return this.req("POST", "/projects", { name })
  }
  listAgents(): Promise<{ agents: { name: string; description: string }[] }> {
    return this.req("GET", "/agents")
  }
  setAgent(id: string, agent: string): Promise<{ ok: boolean; agent: string }> {
    return this.req("POST", `/session/${id}/agent`, { agent })
  }
  messages(id: string): Promise<MessagesResponse> {
    return this.req("GET", `/session/${id}/messages`)
  }
  prompt(id: string, prompt: string, mode: Mode): Promise<{ ok: boolean }> {
    return this.req("POST", `/session/${id}/prompt`, { prompt, mode })
  }
  rename(id: string, title: string): Promise<{ ok: boolean }> {
    return this.req("PATCH", `/session/${id}`, { title })
  }
  remove(id: string): Promise<{ ok: boolean }> {
    return this.req("DELETE", `/session/${id}`)
  }
  searchFiles(q: string): Promise<{ files: string[] }> {
    return this.req("GET", `/files?q=${encodeURIComponent(q)}`)
  }

  // ---- WebSocket ------------------------------------------------------------

  connect(onMessage: (m: ServerMessage) => void): Promise<void> {
    this.handlers.add(onMessage)
    if (this.ws) return Promise.resolve()
    const tokenQ = this.config.token ? `?token=${encodeURIComponent(this.config.token)}` : ""
    const wsUrl = `ws://${this.config.host}:${this.config.port}${WS_PATH}${tokenQ}`
    this.ws = new WebSocket(wsUrl)
    return new Promise((resolve, reject) => {
      if (!this.ws) return reject(new Error("no socket"))
      this.ws.onopen = () => resolve()
      this.ws.onerror = (e) => reject(new Error("websocket error"))
      this.ws.onmessage = (ev) => {
        let msg: ServerMessage
        try {
          msg = JSON.parse(String(ev.data))
        } catch {
          return
        }
        for (const h of this.handlers) h(msg)
      }
    })
  }

  send(msg: ClientMessage): void {
    this.ws?.send(JSON.stringify(msg))
  }

  approve(requestId: string, decision: Decision): void {
    this.send({ type: "approval_response", requestId, decision })
  }

  close(): void {
    this.ws?.close()
    this.ws = null
    this.handlers.clear()
  }
}

export type { SessionSummary, ServerMessage, Message }
