// The Brodex TUI app shell — a network client of the in-container agent server.
// Full-screen layout: scrolling transcript, status bar, multi-line prompt.
// Dialogs (session switcher) and the command palette overlay on top. All agent
// work happens server-side; this renders the stream and sends commands.
import React, { useState, useCallback, useEffect } from "react"
import { Box, useApp, useInput } from "ink"
import { Transcript } from "./components/transcript.tsx"
import { PromptInput } from "./components/prompt-input.tsx"
import { StatusBar } from "./components/status-bar.tsx"
import { CommandPalette } from "./components/command-palette.tsx"
import { SessionDialog } from "./components/session-dialog.tsx"
import { ApprovalDialog } from "./components/approval-dialog.tsx"
import { ProjectPicker } from "./components/project-picker.tsx"
import { useClient } from "./use-client.ts"
import type { BrodexClient } from "./api-client.ts"
import type { Mode } from "../agent/permission.ts"

export interface AppProps {
  client: BrodexClient
  initialThreadId?: string
}

type Overlay = "none" | "palette" | "sessions"

export function App({ client, initialThreadId }: AppProps) {
  const { exit } = useApp()
  const [threadId, setThreadId] = useState(initialThreadId ?? "")
  const [picking, setPicking] = useState(!initialThreadId)
  const [overlay, setOverlay] = useState<Overlay>("none")
  const [mode, setMode] = useState<Mode>("ask")

  const { items, running, usage, pending, lastAssistantText, submit, decideApproval, clearItems, addNote } = useClient({
    client,
    threadId,
    mode,
  })

  const switchThread = useCallback((id: string) => {
    setThreadId(id)
    setOverlay("none")
  }, [])

  const startNewThread = useCallback(() => {
    setPicking(true)
  }, [])

  // Called by the picker once the user chose how to scope the session.
  const onProjectChosen = useCallback(
    async (cwd: string) => {
      const title = cwd === "/workspace" ? "New session" : cwd.split("/").pop() ?? "New session"
      const s = await client.createSession(title, cwd)
      setPicking(false)
      switchThread(s.id)
    },
    [client, switchThread],
  )

  const handleSlashCommand = useCallback(
    (cmd: string) => {
      const [name] = cmd.slice(1).split(/\s+/)
      switch (name) {
        case "new":
          void startNewThread()
          break
        case "sessions":
        case "resume":
          setOverlay("sessions")
          break
        case "clear":
          clearItems()
          break
        case "permissions":
        case "mode":
          setMode((m) => {
            const next: Mode = m === "ask" ? "read-only" : m === "read-only" ? "full" : "ask"
            addNote(`permission mode → ${next}`)
            return next
          })
          break
        case "help":
          addNote(HELP_TEXT)
          break
        case "quit":
        case "exit":
          exit()
          break
        default:
          addNote(`unknown command: /${name}`)
      }
    },
    [startNewThread, clearItems, addNote, exit],
  )

  const onSubmit = useCallback(
    (text: string) => {
      const trimmed = text.trim()
      if (!trimmed) return
      if (trimmed.startsWith("/")) handleSlashCommand(trimmed)
      else void submit(trimmed)
    },
    [submit, handleSlashCommand],
  )

  useInput((input, key) => {
    if (key.ctrl && input === "k") setOverlay((o) => (o === "palette" ? "none" : "palette"))
    else if (key.ctrl && input === "s") setOverlay((o) => (o === "sessions" ? "none" : "sessions"))
    else if (key.ctrl && input === "c") exit()
    else if (key.escape && overlay !== "none") setOverlay("none")
  })

  if (picking) {
    return (
      <Box flexDirection="column" width="100%" height="100%" padding={1}>
        <ProjectPicker client={client} onChosen={onProjectChosen} />
      </Box>
    )
  }

  return (
    <Box flexDirection="column" width="100%" height="100%">
      <Box flexGrow={1} flexDirection="column">
        <Transcript items={items} />
      </Box>

      {overlay === "palette" && (
        <CommandPalette
          onRun={(cmd) => {
            setOverlay("none")
            handleSlashCommand("/" + cmd)
          }}
          onClose={() => setOverlay("none")}
        />
      )}
      {overlay === "sessions" && (
        <SessionDialog
          client={client}
          currentId={threadId}
          onSelect={switchThread}
          onNew={() => void startNewThread()}
          onClose={() => setOverlay("none")}
        />
      )}
      {pending && (
        <ApprovalDialog
          toolName={pending.toolName}
          args={pending.args}
          onDecide={(d) => decideApproval(pending.requestId, d)}
        />
      )}

      <StatusBar threadId={threadId} running={running} mode={mode} usage={usage} />
      <PromptInput
        client={client}
        disabled={running || overlay !== "none" || pending !== null}
        onSubmit={onSubmit}
        lastAssistantText={lastAssistantText}
      />
    </Box>
  )
}

const HELP_TEXT = [
  "Commands:  /new  /sessions  /resume  /permissions  /clear  /help  /quit",
  "Keys:  Ctrl+K palette · Ctrl+S sessions · Ctrl+Y copy last reply · Ctrl+C quit",
  "Permission modes: ask (default) → read-only → full, cycled with /permissions.",
].join("\n")
