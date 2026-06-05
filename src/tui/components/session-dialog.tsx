// Session switcher dialog (Ctrl+S): lists threads from the server.
//   Enter switch · n new · r rename · x delete (confirm y/n) · Esc close
import React, { useState, useEffect, useCallback } from "react"
import { Box, Text, useInput } from "ink"
import TextInput from "ink-text-input"
import type { BrodexClient } from "../api-client.ts"
import type { SessionSummary } from "../server/protocol.ts"

type DialogMode = "list" | "rename" | "confirm-delete"

export function SessionDialog({
  client,
  currentId,
  onSelect,
  onNew,
  onClose,
}: {
  client: BrodexClient
  currentId: string
  onSelect: (id: string) => void
  onNew: () => void
  onClose: () => void
}) {
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [index, setIndex] = useState(0)
  const [mode, setMode] = useState<DialogMode>("list")
  const [draftTitle, setDraftTitle] = useState("")

  const refresh = useCallback(async () => {
    const { sessions } = await client.listSessions()
    setSessions(sessions)
    setIndex((i) => Math.min(i, Math.max(0, sessions.length - 1)))
  }, [client])

  useEffect(() => {
    void client.listSessions().then(({ sessions }) => {
      setSessions(sessions)
      setIndex(Math.max(0, sessions.findIndex((s) => s.id === currentId)))
    })
  }, [client, currentId])

  const current = sessions[index]

  useInput(
    (input, key) => {
      if (key.escape) return onClose()
      if (input === "n") return onNew()
      if (key.return) {
        if (current) onSelect(current.id)
        return
      }
      if (input === "r" && current) {
        setDraftTitle(current.title)
        setMode("rename")
        return
      }
      if (input === "x" && current) {
        setMode("confirm-delete")
        return
      }
      if (key.upArrow) setIndex((i) => Math.max(0, i - 1))
      if (key.downArrow) setIndex((i) => Math.min(sessions.length - 1, i + 1))
    },
    { isActive: mode === "list" },
  )

  useInput(
    (input, key) => {
      if (input === "y") {
        if (current) void client.remove(current.id).then(refresh)
        setMode("list")
      } else if (input === "n" || key.escape) {
        setMode("list")
      }
    },
    { isActive: mode === "confirm-delete" },
  )

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="magenta" paddingX={1}>
      <Text color="magenta" bold>
        Sessions  (Enter switch · n new · r rename · x delete · Esc close)
      </Text>

      {sessions.length === 0 && <Text dimColor>no saved threads yet</Text>}

      {sessions.slice(0, 12).map((s, i) => {
        const isRow = i === index
        if (isRow && mode === "rename") {
          return (
            <Box key={s.id}>
              <Text color="magenta">{"✎ "}</Text>
              <TextInput
                value={draftTitle}
                onChange={setDraftTitle}
                onSubmit={(val) => {
                  void client.rename(s.id, val.trim() || s.title).then(refresh)
                  setMode("list")
                }}
              />
            </Box>
          )
        }
        return (
          <Box key={s.id}>
            <Text color={isRow ? "magenta" : undefined} inverse={isRow && mode === "list"}>
              {s.id === currentId ? "● " : "  "}
              {s.id.slice(0, 16)}
            </Text>
            <Text dimColor>{"  " + truncate(s.title, 40)}</Text>
            <Text dimColor>{`  ${s.tokensInput}/${s.tokensOutput} tok`}</Text>
          </Box>
        )
      })}

      {mode === "confirm-delete" && current && (
        <Box marginTop={1}>
          <Text color="red">{`Delete "${truncate(current.title, 30)}"? (y/n)`}</Text>
        </Box>
      )}
    </Box>
  )
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s
}
