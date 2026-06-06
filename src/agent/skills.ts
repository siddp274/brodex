// Skills: packaged, reusable workflows the agent can load on demand. A skill is
// a folder under <workspace>/.brodex/skills/<name>/ containing a SKILL.md with
// YAML-ish frontmatter (name, description) and a markdown body of instructions.
// The `skill` tool lists available skills in its description and injects a
// skill's body into the conversation when invoked. Runs server-side.
import { readFileSync, existsSync, readdirSync } from "node:fs"
import { resolve } from "node:path"

export interface Skill {
  name: string
  description: string
  /** The instruction body (everything after the frontmatter). */
  body: string
  /** Absolute directory of the skill (for referencing its files). */
  dir: string
}

const SKILLS_SUBDIR = ".brodex/skills"

/** Parse simple `key: value` frontmatter delimited by --- lines. */
function parseFrontmatter(text: string): { meta: Record<string, string>; body: string } {
  const m = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/)
  if (!m) return { meta: {}, body: text }
  const meta: Record<string, string> = {}
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":")
    if (i === -1) continue
    const key = line.slice(0, i).trim()
    let val = line.slice(i + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1)
    meta[key] = val
  }
  return { meta, body: m[2].trim() }
}

/** Discover all skills under the workspace. */
export function listSkills(workspaceRoot = "/workspace"): Skill[] {
  const root = resolve(workspaceRoot, SKILLS_SUBDIR)
  if (!existsSync(root)) return []
  const out: Skill[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const skillFile = resolve(root, entry.name, "SKILL.md")
    if (!existsSync(skillFile)) continue
    try {
      const { meta, body } = parseFrontmatter(readFileSync(skillFile, "utf8"))
      out.push({
        name: meta.name || entry.name,
        description: meta.description || "(no description)",
        body,
        dir: resolve(root, entry.name),
      })
    } catch {
      /* skip malformed */
    }
  }
  return out
}

/** Load a single skill by name. */
export function getSkill(name: string, workspaceRoot = "/workspace"): Skill | undefined {
  return listSkills(workspaceRoot).find((s) => s.name === name)
}
