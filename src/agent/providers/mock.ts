// Mock provider for headless testing — no network, no API key. It runs a
// scripted sequence of turns so we can prove the agent loop (model -> tool ->
// model -> done) works end to end without burning real API calls.
import type { ModelRequest, ModelResponse, Provider } from "../types.ts"

export interface MockTurn {
  text?: string
  toolCalls?: { id: string; name: string; arguments: string }[]
}

/**
 * Build a mock provider that returns the given turns in order. Each call to
 * generate() advances to the next turn; once exhausted it returns a plain text
 * "done" with no tool calls so the loop terminates.
 */
export function createMockProvider(turns: MockTurn[]): Provider {
  let i = 0
  return {
    id: "mock",
    async generate(_req: ModelRequest): Promise<ModelResponse> {
      const turn = turns[i]
      i++
      if (!turn) return { text: "done", toolCalls: [] }
      return {
        text: turn.text ?? "",
        toolCalls: turn.toolCalls ?? [],
      }
    },
  }
}
