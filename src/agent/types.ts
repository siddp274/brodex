// Shared types for the Brodex agent loop. Plain TypeScript — no Effect, no
// heavy framework. These mirror the OpenAI Responses message/tool shapes we
// need without dragging in a full SDK.

export type Role = "system" | "user" | "assistant" | "tool"

/** A tool call the model asked us to run. */
export interface ToolCall {
  /** Provider-assigned id, echoed back with the result. */
  id: string
  name: string
  /** Raw JSON arguments string as emitted by the model. */
  arguments: string
}

/** One message in the conversation. */
export interface Message {
  role: Role
  /** Text content (assistant/user/system). */
  content?: string
  /** Tool calls requested by the assistant. */
  toolCalls?: ToolCall[]
  /** For role:"tool" — which call this answers. */
  toolCallId?: string
  /** For role:"tool" — the tool's textual result. */
  toolResult?: string
}

/** What the provider returns for one turn. */
export interface ModelResponse {
  /** Assistant text, if any. */
  text: string
  /** Tool calls the model wants run, if any. */
  toolCalls: ToolCall[]
  /** Raw usage info if the provider supplied it. */
  usage?: { inputTokens?: number; outputTokens?: number }
}

/** A tool definition handed to the model (name + description + JSON schema). */
export interface ToolDefinition {
  name: string
  description: string
  /** JSON Schema for the parameters object. */
  parameters: Record<string, unknown>
}

/** A request to the provider for one model turn. */
export interface ModelRequest {
  system?: string
  messages: Message[]
  tools?: ToolDefinition[]
}

/**
 * The minimal contract every provider implements. Phase 1 ships an Azure
 * Foundry provider and a mock provider; more can be added without touching the
 * loop.
 */
export interface Provider {
  readonly id: string
  /** Run one model turn and return its response. */
  generate(req: ModelRequest): Promise<ModelResponse>
}
