// Startup project picker. On a new thread, asks how to scope the session:
//   1. an existing project dir under /workspace
//   2. a new project (prompts for a name; creates the dir)
//   3. barebone — no project, chat with the default agent (cwd = /workspace)
// The chosen cwd scopes the session's tools and .brodex config.
import React, { useState, useEffect } from "react"
import { Box, Text, useInput } from "ink"
import TextInput from "ink-text-input"
import type { BrodexClient } from "../api-client.ts"

type Stage = "loading" | "menu" | "pick-existing" | "name-new"

export function ProjectPicker({
  client,
  onChosen,
}: {
  client: BrodexClient
  /** cwd is the absolute container path to scope to (root means barebone). */
  onChosen: (cwd: string) => void
}) {
  const [stage, setStage] = useState<Stage>("loading")
  const [root, setRoot] = useState("/workspace")
  const [projects, setProjects] = useState<string[]>([])
  const [index, setIndex] = useState(0)
  const [name, setName] = useState("")

  useEffect(() => {
    void client.listProjects().then((r) => {
      setRoot(r.root)
      setProjects(r.projects)
      setStage("menu")
    })
  }, [client])

  // Menu: 3 options.
  useInput(
    (input, key) => {
      if (key.upArrow) setIndex((i) => Math.max(0, i - 1))
      else if (key.downArrow) setIndex((i) => Math.min(2, i + 1))
      else if (key.return) {
        if (index === 0) setStage(projects.length ? "pick-existing" : "name-new")
        else if (index === 1) setStage("name-new")
        else onChosen(root) // barebone
      }
    },
    { isActive: stage === "menu" },
  )

  // Pick existing project.
  useInput(
    (input, key) => {
      if (key.escape) return setStage("menu")
      if (key.upArrow) setIndex((i) => Math.max(0, i - 1))
      else if (key.downArrow) setIndex((i) => Math.min(projects.length - 1, i + 1))
      else if (key.return) onChosen(`${root}/${projects[index]}`)
    },
    { isActive: stage === "pick-existing" },
  )

  if (stage === "loading") return <Text dimColor>loading projects…</Text>

  if (stage === "name-new") {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="green" paddingX={1}>
        <Text color="green" bold>
          New project name:
        </Text>
        <TextInput
          value={name}
          onChange={setName}
          onSubmit={async (val) => {
            const clean = val.trim()
            if (!clean) return
            const r = await client.createProject(clean)
            onChosen(r.dir)
          }}
          placeholder="my-project"
        />
      </Box>
    )
  }

  if (stage === "pick-existing") {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="green" paddingX={1}>
        <Text color="green" bold>
          Pick a project (Enter select · Esc back)
        </Text>
        {projects.map((p, i) => (
          <Text key={p} inverse={i === index} color={i === index ? "green" : undefined}>
            {p}
          </Text>
        ))}
      </Box>
    )
  }

  // menu
  const options = [
    projects.length ? "Use an existing project" : "Use an existing project (none yet)",
    "Create a new project",
    "No project — just chat (barebone agent)",
  ]
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="green" paddingX={1}>
      <Text color="green" bold>
        How do you want to work? (↑/↓, Enter)
      </Text>
      {options.map((o, i) => (
        <Text key={o} inverse={i === index} color={i === index ? "green" : undefined}>
          {o}
        </Text>
      ))}
    </Box>
  )
}
