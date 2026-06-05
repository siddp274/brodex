// Bridges the BrodexClient (API) to React/Ink state. Connects the WebSocket,
// maps server messages into transcript items, and exposes submit/usage plus a
// pending-approval signal the app renders as a dialog.
import { useState, useRef, useCallback, useEffect } from "react"
import type { BrodexClient } from "./api-client.ts"
import type { ServerMessage } from "../server/protocol.ts"
import type { Mode, Decision } from "../agent/permission.ts"
import type { TranscriptItem } from "./components/transcript.tsx"
import type { Message } from "../agent/types.ts"

export interface PendingApproval {
  requestId: string
  toolName: string
  args: string
}

export interface UseClientArgs {
  client: BrodexClient
  threadId: string
  mode: Mode
}

function messagesToItems(messages: Message[]): TranscriptItem[] {
  const items: TranscriptItem[] = []
  for (const m of messages) {
    if (m.role === "user" && m.content) items.push({ kind: "user", text: m.content })
    else if (m.role === "assistant" && m.content) items.push({ kind: "assistant", text: m.content })
    else if (m.role === "tool") items.push({ kind: "tool_result", toolName: "tool", result: m.toolResult ?? "" })
  }
  return items
}

export function useClient({ client, threadId, mode }: UseClientArgs) {
  const [items, setItems] = useState<TranscriptItem[]>([])
  const [running, setRunning] = useState(false)
  const [usage, setUsage] = useState({ inputTokens: 0, outputTokens: 0 })
  const [pending, setPending] = useState<PendingApproval | null>(null)
  const [lastAssistantText, setLastAssistantText] = useState("")
  const threadRef = useRef(threadId)
  threadRef.current = threadId

  // Connect WS once; route messages for the active thread into state.
  useEffect(() => {
    const onMessage = (m: ServerMessage) => {
      // Ignore events for other sessions.
      if ("sessionId" in m && m.sessionId !== threadRef.current) return
      switch (m.type) {
        case "run_started":
          setRunning(true)
          break
        case "assistant_text":
          setLastAssistantText(m.text)
          setItems((p) => [...p, { kind: "assistant", text: m.text }])
          break
        case "tool_call":
          setItems((p) => [...p, { kind: "tool_call", toolName: m.toolName, args: m.args }])
          break
        case "tool_result":
          setItems((p) => [...p, { kind: "tool_result", toolName: m.toolName, result: m.result }])
          break
        case "denied":
          setItems((p) => [...p, { kind: "note", text: `⛔ ${m.toolName}: ${m.detail}` }])
          break
        case "usage":
          setUsage((u) => ({ inputTokens: u.inputTokens + m.inputTokens, outputTokens: u.outputTokens + m.outputTokens }))
          break
        case "approval_request":
          setPending({ requestId: m.requestId, toolName: m.toolName, args: m.args })
          break
        case "run_done":
          setRunning(false)
          break
        case "run_error":
          setItems((p) => [...p, { kind: "error", text: m.error }])
          setRunning(false)
          break
      }
    }
    void client.connect(onMessage)
    return () => client.close()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Load history + usage when the active thread changes.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [{ messages }, { sessions }] = await Promise.all([client.messages(threadId), client.listSessions()])
      if (cancelled) return
      setItems(messagesToItems(messages))
      const s = sessions.find((x) => x.id === threadId)
      setUsage({ inputTokens: s?.tokensInput ?? 0, outputTokens: s?.tokensOutput ?? 0 })
    })()
    return () => {
      cancelled = true
    }
  }, [threadId, client])

  const submit = useCallback(
    async (prompt: string) => {
      setItems((p) => [...p, { kind: "user", text: prompt }])
      setRunning(true)
      try {
        await client.prompt(threadId, prompt, mode)
      } catch (e) {
        setItems((p) => [...p, { kind: "error", text: (e as Error).message }])
        setRunning(false)
      }
    },
    [client, threadId, mode],
  )

  const decideApproval = useCallback(
    (requestId: string, decision: Decision) => {
      client.approve(requestId, decision)
      setPending(null)
    },
    [client],
  )

  const clearItems = useCallback(() => setItems([]), [])
  const addNote = useCallback((text: string) => setItems((p) => [...p, { kind: "note", text }]), [])

  return { items, setItems, running, usage, pending, lastAssistantText, submit, decideApproval, clearItems, addNote }
}
