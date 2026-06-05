#!/usr/bin/env bun
// Brodex interactive TUI entry point — runs on the HOST as a client of the
// in-container agent server. Connects over the published port; all agent work
// happens server-side.
import { render } from "ink"
import React from "react"
import { App } from "./app.tsx"
import { BrodexClient } from "./api-client.ts"

// Connection config: host is always localhost (the launcher publishes the port);
// port + token come from env (set by the CLI from the mount config / .env).
const host = process.env.BRODEX_HOST ?? "localhost"
const port = Number(process.env.BRODEX_PORT ?? 7000)
const token = process.env.BRODEX_AUTH_TOKEN

// Parse optional --resume <id> / --new.
const argv = process.argv.slice(2)
let resume: string | undefined
let fresh = false
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--resume") resume = argv[++i]
  else if (argv[i] === "--new") fresh = true
}

const client = new BrodexClient({ host, port, token })

async function main() {
  // Confirm the server is reachable before rendering.
  try {
    await client.health()
  } catch {
    process.stderr.write(
      `brodex: cannot reach the agent server at ${host}:${port}.\n` +
        `Start it with \`brodex up\` (or check the port in config/brodex.mounts.json).\n`,
    )
    process.exit(1)
  }

  // Decide the initial thread: resume id, fresh, or the server's active thread.
  let initialThreadId: string
  if (resume) {
    initialThreadId = resume
  } else {
    const { sessions, activeId } = await client.listSessions()
    if (!fresh && activeId) {
      initialThreadId = activeId
    } else if (!fresh && sessions.length > 0) {
      initialThreadId = sessions[0].id
    } else {
      const s = await client.createSession()
      initialThreadId = s.id
    }
  }

  const app = render(<App client={client} initialThreadId={initialThreadId} />)
  await app.waitUntilExit()
  client.close()
  process.exit(0)
}

main()
