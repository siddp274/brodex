// Confine file operations to the workspace root INSIDE the container. Uses POSIX
// path semantics (the container is Linux) regardless of the host OS. Even though
// the container bounds the agent, this is defense-in-depth: reject paths that
// escape /workspace so a tool can't wander the container's root filesystem
// during ordinary file edits.
import path from "node:path"

const posix = path.posix

export function resolveInWorkspace(workspaceRoot: string, p: string): string {
  const root = posix.resolve(workspaceRoot)
  const target = posix.isAbsolute(p) ? posix.resolve(p) : posix.resolve(root, p)
  const rel = posix.relative(root, target)
  if (rel === "") return target
  if (rel.startsWith("..") || posix.isAbsolute(rel)) {
    throw new Error(`path escapes the workspace: ${p}`)
  }
  return target
}
