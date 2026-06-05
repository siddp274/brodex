// Command palette overlay (Ctrl+K): a filterable list of commands; Enter runs
// the highlighted one. Arrow keys move; Esc closes.
import React, { useState } from "react"
import { Box, Text, useInput } from "ink"

interface Command {
  name: string
  description: string
}

const COMMANDS: Command[] = [
  { name: "new", description: "Start a fresh thread" },
  { name: "sessions", description: "Switch between threads" },
  { name: "permissions", description: "Cycle permission mode (ask / read-only / full)" },
  { name: "clear", description: "Clear the transcript view" },
  { name: "help", description: "Show keybindings and commands" },
  { name: "quit", description: "Exit Brodex" },
]

export function CommandPalette({
  onRun,
  onClose,
}: {
  onRun: (command: string) => void
  onClose: () => void
}) {
  const [filter, setFilter] = useState("")
  const [index, setIndex] = useState(0)

  const matches = COMMANDS.filter(
    (c) => c.name.includes(filter) || c.description.toLowerCase().includes(filter.toLowerCase()),
  )

  useInput((input, key) => {
    if (key.escape) return onClose()
    if (key.return) {
      const chosen = matches[index]
      if (chosen) onRun(chosen.name)
      return
    }
    if (key.upArrow) {
      setIndex((i) => Math.max(0, i - 1))
      return
    }
    if (key.downArrow) {
      setIndex((i) => Math.min(matches.length - 1, i + 1))
      return
    }
    if (key.backspace || key.delete) {
      setFilter((f) => f.slice(0, -1))
      setIndex(0)
      return
    }
    if (input && !key.ctrl && !key.meta) {
      setFilter((f) => f + input)
      setIndex(0)
    }
  })

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text color="cyan" bold>
        Command palette {filter ? `· ${filter}` : ""}
      </Text>
      {matches.length === 0 && <Text dimColor>no matching commands</Text>}
      {matches.map((c, i) => (
        <Box key={c.name}>
          <Text color={i === index ? "cyan" : undefined} inverse={i === index}>
            {`/${c.name}`}
          </Text>
          <Text dimColor>{"  " + c.description}</Text>
        </Box>
      ))}
    </Box>
  )
}
