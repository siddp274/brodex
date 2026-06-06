// Status bar: shows the active thread, run state, and key hints.
import React from "react"
import { Box, Text } from "ink"
import type { Mode } from "../../agent/permission.ts"

const MODE_LABEL: Record<Mode, string> = { ask: "ask", "read-only": "read-only", full: "full-access" }
const MODE_COLOR: Record<Mode, string> = { ask: "yellow", "read-only": "cyan", full: "red" }

export function StatusBar({
  threadId,
  running,
  mode,
  usage,
  agent,
}: {
  threadId: string
  running: boolean
  mode: Mode
  usage: { inputTokens: number; outputTokens: number }
  agent: string
}) {
  return (
    <Box justifyContent="space-between" paddingX={1} borderStyle="round" borderColor="gray">
      <Box>
        <Text color={running ? "yellow" : "green"}>{running ? "● working" : "○ ready"}</Text>
        <Text dimColor>{"  thread "}</Text>
        <Text>{threadId.slice(0, 16)}</Text>
        <Text dimColor>{"  perms "}</Text>
        <Text color={MODE_COLOR[mode]}>{MODE_LABEL[mode]}</Text>
        <Text dimColor>{"  agent "}</Text>
        <Text color="blue">{agent}</Text>
        <Text dimColor>{`  tok ${fmt(usage.inputTokens)}↑/${fmt(usage.outputTokens)}↓`}</Text>
      </Box>
      <Text dimColor>Ctrl+K palette · /permissions · Ctrl+C quit</Text>
    </Box>
  )
}

/** Compact number formatting: 1234 -> 1.2k. */
function fmt(n: number): string {
  if (n < 1000) return String(n)
  return (n / 1000).toFixed(1) + "k"
}
