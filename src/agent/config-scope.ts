// Per-project config scoping with "deeper replaces" semantics. A session has a
// cwd (a project dir under the workspace, or the workspace root itself). For
// each config type, Brodex uses the project's .brodex/<thing> if it exists,
// otherwise falls back to the workspace root's. The project's config stands
// alone — it is NOT merged with the root's.
import { existsSync } from "node:fs"
import { resolve } from "node:path"

export interface Scope {
  /** The workspace root (always /workspace). */
  root: string
  /** The session's working directory (a project dir, or === root). */
  cwd: string
}

/**
 * Resolve which directory to load a given .brodex relative path from.
 * Returns the cwd-scoped path if it exists, else the root-scoped path.
 * `relPath` is e.g. ".brodex/skills" or ".brodex/hooks.json".
 */
export function resolveConfigPath(scope: Scope, relPath: string): string {
  const scoped = resolve(scope.cwd, relPath)
  if (scope.cwd !== scope.root && existsSync(scoped)) return scoped
  return resolve(scope.root, relPath)
}

/**
 * The directory whose .brodex should be used for the session — the project dir
 * if it has a .brodex, else the workspace root. Memory/instruction files (which
 * live at the dir root, not under .brodex) follow the same rule via this dir.
 */
export function effectiveConfigRoot(scope: Scope): string {
  if (scope.cwd !== scope.root && existsSync(resolve(scope.cwd, ".brodex"))) return scope.cwd
  return scope.root
}
