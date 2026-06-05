// Load brodex/.env into process.env on the HOST. Brodex's provider/LLM calls
// run on the host, so the keys must be in the host process environment. We load
// the .env that sits next to the brodex source, regardless of the current
// working directory (the CLI may spawn us from elsewhere). Existing env vars
// win, so anything already exported in the shell takes precedence.
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { existsSync, readFileSync } from "node:fs"

const HERE = dirname(fileURLToPath(import.meta.url))
// brodex/.env (two levels up from src/agent/)
const ENV_PATH = resolve(HERE, "..", "..", ".env")

let loaded = false

export function loadEnv(): void {
  if (loaded) return
  loaded = true
  if (!existsSync(ENV_PATH)) return
  const text = readFileSync(ENV_PATH, "utf8")
  for (const raw of text.split("\n")) {
    const line = raw.trim()
    if (!line || line.startsWith("#")) continue
    const eq = line.indexOf("=")
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    // Strip surrounding quotes if present.
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    // Don't override anything already set in the real environment.
    if (process.env[key] === undefined) process.env[key] = val
  }
}
