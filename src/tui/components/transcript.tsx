// The scrolling transcript: user/assistant turns, tool-call cards, tool results,
// notes and errors. Renders edit diffs and shell output with light styling.
import React from "react"
import { Box, Text } from "ink"

export type TranscriptItem =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "tool_call"; toolName: string; args: string }
  | { kind: "tool_result"; toolName: string; result: string }
  | { kind: "note"; text: string }
  | { kind: "error"; text: string }

export function Transcript({ items }: { items: TranscriptItem[] }) {
  return (
    <Box flexDirection="column" paddingX={1}>
      {items.map((item, i) => (
        <Item key={i} item={item} />
      ))}
    </Box>
  )
}

function Item({ item }: { item: TranscriptItem }) {
  switch (item.kind) {
    case "user":
      return (
        <Box marginTop={1}>
          <Text color="cyan" bold>{"› "}</Text>
          <Text>{item.text}</Text>
        </Box>
      )
    case "assistant":
      return (
        <Box marginTop={1} flexDirection="column">
          <Text>{item.text}</Text>
        </Box>
      )
    case "tool_call":
      return (
        <Box marginTop={1}>
          <Text color="yellow">{"  ⚙ "}</Text>
          <Text color="yellow">{item.toolName}</Text>
          <Text dimColor>{" " + truncate(item.args, 120)}</Text>
        </Box>
      )
    case "tool_result":
      return <ToolResult toolName={item.toolName} result={item.result} />
    case "note":
      return (
        <Box marginTop={1}>
          <Text dimColor>{item.text}</Text>
        </Box>
      )
    case "error":
      return (
        <Box marginTop={1}>
          <Text color="red">{"  ✗ " + item.text}</Text>
        </Box>
      )
  }
}

/** Render a tool result; show edit/diff and shell output with mild styling. */
function ToolResult({ toolName, result }: { toolName: string; result: string }) {
  const lines = result.split("\n").slice(0, 18) // cap height; full text is persisted
  const more = result.split("\n").length - lines.length
  return (
    <Box flexDirection="column" marginLeft={4}>
      {lines.map((line, i) => (
        <Text key={i} color={lineColor(line)} dimColor={line.startsWith("exit ")}>
          {line}
        </Text>
      ))}
      {more > 0 && <Text dimColor>{`  … ${more} more lines`}</Text>}
    </Box>
  )
}

/** Color diff-ish lines: + green, - red, otherwise default. */
function lineColor(line: string): string | undefined {
  if (line.startsWith("+")) return "green"
  if (line.startsWith("-")) return "red"
  if (line.startsWith("error")) return "red"
  return undefined
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s
}
