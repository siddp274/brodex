// Project memory / instructions. On each run the server reads project-level
// instruction files from the workspace and prepends them to the system prompt,
// so the agent follows your conventions. Also supports a durable memory file the
// agent can append learnings to. Runs server-side (inside the container).
import { readFileSync, existsSync, appendFileSync, mkdirSync } from "node:fs"
import { resolve, dirname } from "node:path"

// Instruction files read from the workspace root, in priority order. The first
// few mirror common conventions (AGENTS.md, CLAUDE.md); memory.md is Brodex's
// own durable scratchpad.
const INSTRUCTION_FILES = ["AGENTS.md", "CLAUDE.md", ".brodex/memory.md"]

export interface MemoryContext {
  /** Combined instruction text to prepend to the system prompt, or "". */
  text: string
  /** Which files contributed (for logging/UX). */
  sources: string[]
}

/** Read instruction/memory files from the workspace. */
export function loadMemory(workspaceRoot = "/workspace"): MemoryContext {
  const parts: string[] = []
  const sources: string[] = []
  for (const rel of INSTRUCTION_FILES) {
    const path = resolve(workspaceRoot, rel)
    if (!existsSync(path)) continue
    try {
      const content = readFileSync(path, "utf8").trim()
      if (content) {
        parts.push(`# From ${rel}\n${content}`)
        sources.push(rel)
      }
    } catch {
      /* skip unreadable */
    }
  }
  return { text: parts.join("\n\n"), sources }
}

/** Build the full system prompt: base prompt + project memory (if any). */
export function withMemory(basePrompt: string, workspaceRoot = "/workspace"): { prompt: string; sources: string[] } {
  const mem = loadMemory(workspaceRoot)
  if (!mem.text) return { prompt: basePrompt, sources: [] }
  return {
    prompt: `${basePrompt}\n\n## Project instructions and memory\nFollow these project-specific instructions and remembered facts:\n\n${mem.text}`,
    sources: mem.sources,
  }
}

/** Append a durable note to .brodex/memory.md so it persists across sessions. */
export function rememberNote(note: string, workspaceRoot = "/workspace"): void {
  const path = resolve(workspaceRoot, ".brodex/memory.md")
  mkdirSync(dirname(path), { recursive: true })
  const stamp = new Date().toISOString().slice(0, 10)
  appendFileSync(path, `\n- (${stamp}) ${note.trim()}\n`, "utf8")
}
