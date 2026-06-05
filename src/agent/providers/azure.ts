// Azure AI Foundry provider (OpenAI Responses API), api-key auth.
//
// Talks to the endpoint with plain fetch — no SDK. The base URL is everything
// BEFORE /responses; we append the operation and the api-version query param,
// matching how opencode's azure provider constructs the URL.
import type { Message, ModelRequest, ModelResponse, Provider, ToolCall } from "../types.ts"

export interface AzureProviderConfig {
  /** e.g. https://<resource>.services.ai.azure.com/api/projects/<proj>/openai/v1 */
  baseURL: string
  apiKey: string
  apiVersion?: string
  /** Deployment / model name to call. */
  model: string
}

/** Map our internal messages to the Responses API "input" items. */
function toResponsesInput(messages: Message[]): unknown[] {
  const input: unknown[] = []
  for (const m of messages) {
    if (m.role === "tool") {
      // A tool result is its own input item referencing the call id.
      input.push({
        type: "function_call_output",
        call_id: m.toolCallId,
        output: m.toolResult ?? "",
      })
      continue
    }
    if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
      // Emit the assistant's text (if any) then each function call.
      if (m.content) input.push({ role: "assistant", content: m.content })
      for (const tc of m.toolCalls) {
        input.push({
          type: "function_call",
          call_id: tc.id,
          name: tc.name,
          arguments: tc.arguments,
        })
      }
      continue
    }
    input.push({ role: m.role, content: m.content ?? "" })
  }
  return input
}

/** Map our tool definitions to the Responses API "tools" shape. */
function toResponsesTools(req: ModelRequest): unknown[] | undefined {
  if (!req.tools || req.tools.length === 0) return undefined
  return req.tools.map((t) => ({
    type: "function",
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }))
}

/** Pull text + tool calls out of a Responses API result. */
function parseResponse(data: any): ModelResponse {
  const toolCalls: ToolCall[] = []
  let text = ""

  const output: any[] = Array.isArray(data?.output) ? data.output : []
  for (const item of output) {
    if (item?.type === "function_call") {
      toolCalls.push({
        id: item.call_id ?? item.id ?? "",
        name: item.name ?? "",
        arguments: typeof item.arguments === "string" ? item.arguments : JSON.stringify(item.arguments ?? {}),
      })
    } else if (item?.type === "message") {
      const parts: any[] = Array.isArray(item.content) ? item.content : []
      for (const p of parts) {
        if (p?.type === "output_text" && typeof p.text === "string") text += p.text
      }
    }
  }

  // Some gateways also expose a convenience aggregate.
  if (!text && typeof data?.output_text === "string") text = data.output_text

  return {
    text,
    toolCalls,
    usage: data?.usage
      ? { inputTokens: data.usage.input_tokens, outputTokens: data.usage.output_tokens }
      : undefined,
  }
}

export function createAzureProvider(config: AzureProviderConfig): Provider {
  // Normalize the base URL: trim whitespace/CR, drop trailing slashes, and
  // tolerate a base that already includes the /responses operation (a common
  // copy-paste of the full endpoint) by stripping it back to the path root.
  const base = config.baseURL
    .trim()
    .replace(/[\r\n]+$/, "")
    .replace(/\/+$/, "")
    .replace(/\/responses$/, "")
  // Newer Azure AI Foundry endpoints use a /v1 path that REJECTS the
  // api-version query param ("not allowed when using /v1 path"). Classic Azure
  // OpenAI endpoints require it. Append it only when the base is not a /vN path.
  const isVersionedPath = /\/v\d+$/.test(base)
  const apiVersion = config.apiVersion ?? "2025-01-01-preview"
  const url = isVersionedPath
    ? `${base}/responses`
    : `${base}/responses?api-version=${encodeURIComponent(apiVersion)}`

  return {
    id: "azure",
    async generate(req: ModelRequest): Promise<ModelResponse> {
      const body: Record<string, unknown> = {
        model: config.model,
        input: toResponsesInput(req.messages),
      }
      if (req.system) body.instructions = req.system
      const tools = toResponsesTools(req)
      if (tools) body.tools = tools

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "api-key": config.apiKey,
        },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const detail = await res.text().catch(() => "")
        throw new Error(`azure provider HTTP ${res.status}: ${detail.slice(0, 500)}`)
      }

      const data = await res.json()
      return parseResponse(data)
    },
  }
}
