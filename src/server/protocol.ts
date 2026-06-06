// Wire protocol shared by the in-container agent server and its clients (TUI
// now; phone/web later). HTTP handles session/prompt/mode management; the
// WebSocket carries live run events and the approval round-trip.
import type { Decision, Mode } from "../agent/permission.ts"
import type { Message } from "../agent/types.ts"

// ---- HTTP request/response bodies ------------------------------------------

export interface CreateSessionResponse {
  id: string
  title: string
  cwd?: string
}

export interface SessionSummary {
  id: string
  title: string
  timeUpdated: number
  tokensInput: number
  tokensOutput: number
}

export interface ListSessionsResponse {
  sessions: SessionSummary[]
  activeId?: string
}

export interface MessagesResponse {
  messages: Message[]
}

export interface PromptRequest {
  prompt: string
  /** Optional: override permission mode for this run. */
  mode?: Mode
}

export interface RenameRequest {
  title: string
}

export interface ModeRequest {
  mode: Mode
}

// ---- WebSocket messages -----------------------------------------------------

/** Messages the SERVER pushes to clients over the WebSocket. */
export type ServerMessage =
  | { type: "hello"; activeId?: string }
  | { type: "run_started"; sessionId: string }
  | { type: "assistant_text"; sessionId: string; text: string }
  | { type: "tool_call"; sessionId: string; toolName: string; args: string }
  | { type: "tool_result"; sessionId: string; toolName: string; result: string }
  | { type: "denied"; sessionId: string; toolName: string; detail: string }
  | { type: "usage"; sessionId: string; inputTokens: number; outputTokens: number }
  | { type: "run_done"; sessionId: string }
  | { type: "run_error"; sessionId: string; error: string }
  | { type: "approval_request"; sessionId: string; requestId: string; toolName: string; args: string; mode: Mode }

/** Messages a CLIENT sends to the server over the WebSocket. */
export type ClientMessage =
  | { type: "subscribe"; sessionId: string }
  | { type: "approval_response"; requestId: string; decision: Decision }

export const WS_PATH = "/ws"
