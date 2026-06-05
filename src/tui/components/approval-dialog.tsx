// Approval dialog: shown when a tool call needs the user's OK. Pauses the run
// until the user picks Allow once / Allow for session / Deny.
import React, { useState } from "react"
import { Box, Text, useInput } from "ink"
import type { Decision } from "../../agent/permission.ts"

const CHOICES: { decision: Decision; label: string; hint: string }[] = [
  { decision: "allow-once", label: "Allow once", hint: "run this call" },
  { decision: "allow-session", label: "Allow for session", hint: "stop asking for this tool" },
  { decision: "deny", label: "Deny", hint: "skip this call" },
]

export function ApprovalDialog({
  toolName,
  args,
  onDecide,
}: {
  toolName: string
  args: string
  onDecide: (d: Decision) => void
}) {
  const [index, setIndex] = useState(0)

  useInput((input, key) => {
    if (key.leftArrow) setIndex((i) => Math.max(0, i - 1))
    else if (key.rightArrow) setIndex((i) => Math.min(CHOICES.length - 1, i + 1))
    else if (key.return) onDecide(CHOICES[index].decision)
    else if (input === "a") onDecide("allow-once")
    else if (input === "s") onDecide("allow-session")
    else if (input === "d" || key.escape) onDecide("deny")
  })

  const preview = args.length > 120 ? args.slice(0, 120) + "…" : args

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
      <Text color="yellow" bold>
        Approve tool call?
      </Text>
      <Box>
        <Text color="yellow">{toolName}</Text>
        <Text dimColor>{"  " + preview}</Text>
      </Box>
      <Box marginTop={1}>
        {CHOICES.map((c, i) => (
          <Box key={c.decision} marginRight={2}>
            <Text inverse={i === index} color={i === index ? "yellow" : undefined}>
              {` ${c.label} `}
            </Text>
          </Box>
        ))}
      </Box>
      <Text dimColor>←/→ then Enter · or a/s/d</Text>
    </Box>
  )
}
