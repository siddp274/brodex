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

export interface LocalServer {
  type: "local"
  command: string[] // e.g. ["npx","-y","@some/mcp-server"]
  environment?: Record<string, string>
  disabled?: boolean
}
export interface RemoteServer {
  type: "remote"
  url: string
  headers?: Record<string, string>
  disabled?: boolean
}
export type McpServer = LocalServer | RemoteServer

export interface McpConfig {
  servers: Record<string, McpServer>
}

const MCP_FILE = ".brodex/mcp.json"

export function loadMcpConfig(workspaceRoot = "/workspace"): McpConfig {
  const path = resolve(workspaceRoot, MCP_FILE)
  if (!existsSync(path)) return { servers: {} }
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<McpConfig>
    return { servers: raw.servers ?? {} }
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
      if (server.type === "local") {
        transport = new StdioClientTransport({
          command: server.command[0],
          args: server.command.slice(1),
          env: { ...process.env, ...(server.environment ?? {}) } as Record<string, string>,
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
