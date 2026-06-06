// Agent picker (/agent or Ctrl+A): choose which agent persona handles the
// session. Lists built-in and user-defined agents from the server.
import React, { useState, useEffect } from "react"
import { Box, Text, useInput } from "ink"
import type { BrodexClient } from "../api-client.ts"

export function AgentDialog({
  client,
  current,
  onSelect,
  onClose,
}: {
  client: BrodexClient
  current: string
  onSelect: (name: string) => void
  onClose: () => void
}) {
  const [agents, setAgents] = useState<{ name: string; description: string }[]>([])
  const [index, setIndex] = useState(0)

  useEffect(() => {
    void client.listAgents().then(({ agents }) => {
      setAgents(agents)
      setIndex(Math.max(0, agents.findIndex((a) => a.name === current)))
    })
  }, [client, current])

  useInput((input, key) => {
    if (key.escape) return onClose()
    if (key.return) {
      if (agents[index]) onSelect(agents[index].name)
      return
    }
    if (key.upArrow) setIndex((i) => Math.max(0, i - 1))
    if (key.downArrow) setIndex((i) => Math.min(agents.length - 1, i + 1))
  })

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="blue" paddingX={1}>
      <Text color="blue" bold>
        Choose agent (Enter select · Esc close)
      </Text>
      {agents.length === 0 && <Text dimColor>loading…</Text>}
      {agents.map((a, i) => (
        <Box key={a.name}>
          <Text color={i === index ? "blue" : undefined} inverse={i === index}>
            {a.name === current ? "● " : "  "}
            {a.name}
          </Text>
          <Text dimColor>{"  " + a.description}</Text>
        </Box>
      ))}
    </Box>
  )
}
