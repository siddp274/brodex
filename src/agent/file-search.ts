// Fuzzy-ish file search over the workspace, for @-mention completion. Runs
// server-side (natively in the container). Lists files under the workspace and
// ranks them against a query. Cached; invalidate after the agent changes files.
import { spawnSync } from "node:child_process"

let cache: string[] | null = null

/** List workspace files (relative paths), skipping node_modules/.git. Cached. */
export function listWorkspaceFiles(workspaceRoot = "/workspace"): string[] {
  if (cache) return cache
  const r = spawnSync(
    "bash",
    [
      "-lc",
      `cd ${shq(workspaceRoot)} && find . -type f -not -path '*/node_modules/*' -not -path '*/.git/*' 2>/dev/null | sed 's|^\\./||' | head -2000`,
    ],
    { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
  )
  if (r.status !== 0) {
    cache = []
    return cache
  }
  cache = (r.stdout ?? "").split("\n").map((s) => s.trim()).filter(Boolean)
  return cache
}

export function invalidateFileCache(): void {
  cache = null
}

/** Rank files against a query (substring → basename → subsequence). */
export function searchFiles(query: string, limit = 8, workspaceRoot = "/workspace"): string[] {
  const files = listWorkspaceFiles(workspaceRoot)
  const q = query.toLowerCase()
  if (!q) return files.slice(0, limit)

  const scored: Array<{ path: string; score: number }> = []
  for (const path of files) {
    const lower = path.toLowerCase()
    const base = lower.split("/").pop() ?? lower
    let score = -1
    if (lower.includes(q)) score = 100 - lower.indexOf(q)
    else if (base.includes(q)) score = 60 - base.indexOf(q)
    else if (isSubsequence(q, lower)) score = 20
    if (score >= 0) scored.push({ path, score })
  }
  scored.sort((a, b) => b.score - a.score || a.path.length - b.path.length)
  return scored.slice(0, limit).map((s) => s.path)
}

function isSubsequence(needle: string, hay: string): boolean {
  let i = 0
  for (let j = 0; j < hay.length && i < needle.length; j++) {
    if (hay[j] === needle[i]) i++
  }
  return i === needle.length
}

function shq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}
