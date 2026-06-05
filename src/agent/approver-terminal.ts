// Terminal approver for headless `brodex agent` runs. When a tool call needs
// approval, prompt on stdin: [a]llow once / [s]ession / [d]eny.
import { createInterface } from "node:readline"
import type { Approver, Decision } from "./permission.ts"

function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr })
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer.trim().toLowerCase())
    })
  })
}

export const terminalApprover: Approver = async ({ toolName, args }) => {
  const preview = args.length > 100 ? args.slice(0, 100) + "…" : args
  process.stderr.write(`\nbrodex: approve "${toolName}"? ${preview}\n`)
  const answer = await ask("  [a]llow once · [s]ession · [d]eny (default deny): ")
  let decision: Decision
  if (answer === "a" || answer === "allow" || answer === "y" || answer === "yes") decision = "allow-once"
  else if (answer === "s" || answer === "session") decision = "allow-session"
  else decision = "deny"
  return decision
}
