// The prompt input: single-line editing via ink-text-input, draft history
// (Up/Down to recall prior prompts), @-file autocomplete (type @ then part of a
// filename to fuzzy-search the workspace), and a copy-last-reply key (Ctrl+Y).
import React, { useState, useRef, useEffect } from "react"
import { Box, Text, useInput } from "ink"
import TextInput from "ink-text-input"
import clipboard from "clipboardy"
import type { BrodexClient } from "../api-client.ts"

export interface PromptInputProps {
  client: BrodexClient
  disabled: boolean
  onSubmit: (text: string) => void
  lastAssistantText: string
}

/** Extract the @-token currently being typed at the end of the value, if any. */
function activeMention(value: string): { token: string; start: number } | null {
  const m = value.match(/(?:^|\s)@([^\s]*)$/)
  if (!m) return null
  const token = m[1]
  const start = value.length - token.length - 1 // position of '@'
  return { token, start }
}

export function PromptInput({ client, disabled, onSubmit, lastAssistantText }: PromptInputProps) {
  const [value, setValue] = useState("")
  const history = useRef<string[]>([])
  const histIdx = useRef<number>(-1)
  const [copied, setCopied] = useState(false)
  const [mentionIdx, setMentionIdx] = useState(0)
  const [matches, setMatches] = useState<string[]>([])

  const mention = activeMention(value)

  // Query the server for file matches when the @-token changes (debounced).
  useEffect(() => {
    if (!mention) {
      setMatches([])
      return
    }
    let cancelled = false
    const t = setTimeout(() => {
      client
        .searchFiles(mention.token)
        .then((r) => {
          if (!cancelled) setMatches(r.files)
        })
        .catch(() => {
          if (!cancelled) setMatches([])
        })
    }, 120)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [mention?.token, client])

  const showMatches = mention !== null && matches.length > 0

  const insertMatch = (path: string) => {
    if (!mention) return
    const before = value.slice(0, mention.start)
    setValue(`${before}@${path} `)
    setMentionIdx(0)
  }

  useInput(
    (input, key) => {
      // Copy last assistant reply.
      if (key.ctrl && input === "y") {
        if (lastAssistantText) {
          clipboard.writeSync(lastAssistantText)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        }
        return
      }
      // When the @-mention list is open, arrows + Tab/Enter navigate it.
      if (showMatches) {
        if (key.upArrow) {
          setMentionIdx((i) => Math.max(0, i - 1))
          return
        }
        if (key.downArrow) {
          setMentionIdx((i) => Math.min(matches.length - 1, i + 1))
          return
        }
        if (key.tab) {
          insertMatch(matches[mentionIdx])
          return
        }
        // Enter while the list is open inserts rather than submits.
        if (key.return) {
          insertMatch(matches[mentionIdx])
          return
        }
        return
      }
      // Draft history recall (only when not mid-mention).
      if (key.upArrow) {
        if (history.current.length === 0) return
        histIdx.current = Math.min(histIdx.current + 1, history.current.length - 1)
        setValue(history.current[history.current.length - 1 - histIdx.current] ?? "")
      } else if (key.downArrow) {
        if (histIdx.current <= 0) {
          histIdx.current = -1
          setValue("")
        } else {
          histIdx.current -= 1
          setValue(history.current[history.current.length - 1 - histIdx.current] ?? "")
        }
      }
    },
    { isActive: !disabled },
  )

  const handleSubmit = (text: string) => {
    if (showMatches) return // Enter is consumed by the mention list above
    if (!text.trim()) return
    history.current.push(text)
    histIdx.current = -1
    setValue("")
    onSubmit(text)
  }

  return (
    <Box flexDirection="column">
      {showMatches && (
        <Box flexDirection="column" borderStyle="round" borderColor="blue" paddingX={1}>
          <Text dimColor>files matching @{mention!.token} — ↑/↓, Tab/Enter to insert</Text>
          {matches.map((path, i) => (
            <Text key={path} inverse={i === mentionIdx} color={i === mentionIdx ? "blue" : undefined}>
              {path}
            </Text>
          ))}
        </Box>
      )}
      <Box borderStyle="round" borderColor={disabled ? "gray" : "cyan"} paddingX={1}>
        <Text color="cyan">{"❯ "}</Text>
        {disabled ? (
          <Text dimColor>{value || "…working (input paused)"}</Text>
        ) : (
          <TextInput value={value} onChange={setValue} onSubmit={handleSubmit} placeholder="Ask Brodex, @file, or /help" />
        )}
      </Box>
      {copied && <Text color="green">  copied last reply to clipboard</Text>}
    </Box>
  )
}
