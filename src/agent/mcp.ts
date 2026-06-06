// MCP (Model Context Protocol) integration. Connects to configured MCP servers
// — local (a command spawned over stdio) or remote (an HTTP URL) — lists their
// tools, and adapts each into a Brodex tool so the agent can call them like any
// built-in. Runs server-side inside the container. Config: .brodex/mcp.json in
// the workspace, mirroring opencode's local/remote model.
import { readFileSync, existsSync } from "node:fs"
import { resolve } from "node:path"
import { z } from "zod"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import type { AnyTool } from "./tool.ts"

// Internal normalized shape. We accept the de-facto-standard MCP config
// (`mcpServers`, `type:"stdio"|"http"`, `command`/`args`, `url`/`headers`) as
// well as Brodex's earlier form (`servers`, `type:"local"|"remote"`) for
// back-compat, and normalize both to this.
export interface StdioServer {
  transport: "stdio"
  command: string
  args: string[]
  env?: Record<string, string>
  disabled?: boolean
}
export interface HttpServer {
  transport: "http"
  url: string
  headers?: Record<string, string>
  disabled?: boolean
}
export type McpServer = StdioServer | HttpServer

export interface McpConfig {
  servers: Record<string, McpServer>
}

const MCP_FILE = ".brodex/mcp.json"

/** Normalize one raw server entry (standard or legacy) into McpServer. */
function normalizeServer(raw: any): McpServer | undefined {
  if (!raw || typeof raw !== "object") return undefined
  const type = raw.type ?? raw.transport
  const disabled = raw.disabled ?? raw.enabled === false

  // HTTP / remote.
  if (type === "http" || type === "streamable-http" || type === "sse" || type === "remote" || (!type && raw.url)) {
    if (!raw.url) return undefined
    return { transport: "http", url: raw.url, headers: raw.headers, disabled }
  }
  // stdio / local.
  if (type === "stdio" || type === "local" || (!type && (raw.command || Array.isArray(raw.command)))) {
    // command may be a string (+ args) or an array [cmd, ...args] (legacy).
    let command: string
    let args: string[]
    if (Array.isArray(raw.command)) {
      command = raw.command[0]
      args = raw.command.slice(1)
    } else {
      command = raw.command
      args = raw.args ?? []
    }
    if (!command) return undefined
    return { transport: "stdio", command, args, env: raw.env ?? raw.environment, disabled }
  }
  return undefined
}

export function loadMcpConfig(workspaceRoot = "/workspace"): McpConfig {
  const path = resolve(workspaceRoot, MCP_FILE)
  if (!existsSync(path)) return { servers: {} }
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, any>
    // Standard key is `mcpServers`; accept legacy `servers` too.
    const rawServers = raw.mcpServers ?? raw.servers ?? {}
    const servers: Record<string, McpServer> = {}
    for (const [name, entry] of Object.entries(rawServers)) {
      if (name.startsWith("$")) continue // skip $comment etc.
      const norm = normalizeServer(entry)
      if (norm) servers[name] = norm
    }
    return { servers }
  } catch {
    return { servers: {} }
  }
}

/** A connected MCP server plus the Brodex tools it contributes. */
export interface McpConnection {
  name: string
  client: Client
  tools: AnyTool[]
  close: () => Promise<void>
}

/** Convert one MCP tool definition into a Brodex AnyTool that proxies calls. */
function adaptTool(serverName: string, client: Client, def: { name: string; description?: string; inputSchema?: unknown }): AnyTool {
  // Namespace the tool so servers can't collide: <server>__<tool>.
  const toolName = `${serverName}__${def.name}`
  return {
    name: toolName,
    description: (def.description ?? `MCP tool ${def.name} from ${serverName}`).slice(0, 1024),
    // The model sends JSON; we pass it straight to the MCP server. Use a passthrough
    // schema so arbitrary args are accepted (the server validates).
    parameters: z.object({}).passthrough(),
    async execute(args: Record<string, unknown>) {
      try {
        const res = await client.callTool({ name: def.name, arguments: args })
        const content = (res as any).content
        if (Array.isArray(content)) {
          return content
            .map((c: any) => (c.type === "text" ? c.text : JSON.stringify(c)))
            .join("\n")
        }
        return JSON.stringify(res)
      } catch (e) {
        return `error: MCP tool "${toolName}" failed: ${(e as Error).message}`
      }
    },
  } as AnyTool
}

/** Connect to all enabled MCP servers and gather their tools. Best-effort: a
 *  server that fails to connect is skipped with a warning, not fatal. */
export async function connectMcpServers(workspaceRoot = "/workspace"): Promise<McpConnection[]> {
  const { servers } = loadMcpConfig(workspaceRoot)
  const connections: McpConnection[] = []

  for (const [name, server] of Object.entries(servers)) {
    if (server.disabled) continue
    try {
      const client = new Client({ name: "brodex", version: "0.0.1" }, { capabilities: {} })
      let transport: StdioClientTransport | StreamableHTTPClientTransport
      if (server.transport === "stdio") {
        transport = new StdioClientTransport({
          command: server.command,
          args: server.args,
          env: { ...process.env, ...(server.env ?? {}) } as Record<string, string>,
        })
      } else {
        transport = new StreamableHTTPClientTransport(new URL(server.url), {
          requestInit: server.headers ? { headers: server.headers } : undefined,
        })
      }
      await client.connect(transport)
      const { tools } = await client.listTools()
      const adapted = tools.map((t) => adaptTool(name, client, t))
      connections.push({
        name,
        client,
        tools: adapted,
        close: () => client.close(),
      })
    } catch (e) {
      process.stderr.write(`brodex: MCP server "${name}" failed to connect: ${(e as Error).message}\n`)
    }
  }
  return connections
}
