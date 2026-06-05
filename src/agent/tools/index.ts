// The Brodex tool set. The agent runs INSIDE the container, so tools operate
// natively on the container's filesystem (which includes the mounted
// /workspace volume) via node:fs and spawn — no docker exec indirection. The
// container is the isolation boundary; tools are confined to the workspace root.
import { z } from "zod"
import { readFile, writeFile, mkdir } from "node:fs/promises"
import { dirname, join, relative } from "node:path"
import { spawnSync } from "node:child_process"
import { readdir } from "node:fs/promises"
import { defineTool, type AnyTool } from "../tool.ts"
import { resolveInWorkspace } from "../safe-path.ts"

const MAX_READ_LINES = 2000
const MAX_LINE_LEN = 2000

const read = defineTool({
  name: "read",
  description:
    "Read a file from the workspace. Paths may be absolute (within /workspace) or relative to it. Returns up to 2000 lines, each prefixed by its line number as `<n>: <content>`. Use offset to read later sections.",
  parameters: z.object({
    filePath: z.string().describe("Path to the file, within the workspace"),
    offset: z.number().optional().describe("1-indexed line to start from"),
    limit: z.number().optional().describe("Max lines to read (default 2000)"),
  }),
  async execute(args, ctx) {
    const abs = resolveInWorkspace(ctx.workspaceRoot, args.filePath)
    let text: string
    try {
      text = await readFile(abs, "utf8")
    } catch (e) {
      return `error reading ${args.filePath}: ${(e as Error).message}`
    }
    const lines = text.split("\n")
    const start = Math.max(0, (args.offset ?? 1) - 1)
    const limit = args.limit ?? MAX_READ_LINES
    const slice = lines.slice(start, start + limit)
    const body = slice
      .map((line, i) => {
        const n = start + i + 1
        const truncated = line.length > MAX_LINE_LEN ? line.slice(0, MAX_LINE_LEN) + "… (truncated)" : line
        return `${n}: ${truncated}`
      })
      .join("\n")
    return body || "(empty file)"
  },
})

const write = defineTool({
  name: "write",
  description:
    "Write a file in the workspace, creating parent directories. Overwrites existing files. Prefer editing existing files over creating new ones.",
  parameters: z.object({
    filePath: z.string().describe("Path to write, within the workspace"),
    content: z.string().describe("Full file content"),
  }),
  async execute(args, ctx) {
    const abs = resolveInWorkspace(ctx.workspaceRoot, args.filePath)
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, args.content, "utf8")
    return `wrote ${args.content.length} bytes to ${args.filePath}`
  },
})

const edit = defineTool({
  name: "edit",
  description:
    "Replace an exact string in a file. Fails if oldString is absent, or present more than once (provide more context or set replaceAll). Preserve exact indentation when matching.",
  parameters: z.object({
    filePath: z.string().describe("Path to the file, within the workspace"),
    oldString: z.string().describe("Exact text to replace"),
    newString: z.string().describe("Replacement text"),
    replaceAll: z.boolean().optional().describe("Replace every occurrence"),
  }),
  async execute(args, ctx) {
    const abs = resolveInWorkspace(ctx.workspaceRoot, args.filePath)
    let text: string
    try {
      text = await readFile(abs, "utf8")
    } catch (e) {
      return `error: cannot read ${args.filePath}: ${(e as Error).message}`
    }
    if (!text.includes(args.oldString)) return `error: oldString not found in ${args.filePath}`
    if (!args.replaceAll) {
      const first = text.indexOf(args.oldString)
      const second = text.indexOf(args.oldString, first + args.oldString.length)
      if (second !== -1) {
        return `error: multiple matches for oldString in ${args.filePath}; add context or set replaceAll`
      }
    }
    const updated = args.replaceAll
      ? text.split(args.oldString).join(args.newString)
      : text.replace(args.oldString, args.newString)
    await writeFile(abs, updated, "utf8")
    return `edited ${args.filePath}`
  },
})

const glob = defineTool({
  name: "glob",
  description:
    "Find files matching a glob pattern (e.g. **/*.ts) within the workspace. Returns matching paths relative to the workspace root.",
  parameters: z.object({
    pattern: z.string().describe("Glob pattern, e.g. src/**/*.ts"),
  }),
  async execute(args, ctx) {
    const root = resolveInWorkspace(ctx.workspaceRoot, ".")
    const matches: string[] = []
    const g = (globalThis as any).Bun?.Glob
    if (g) {
      const glob = new g(args.pattern)
      for await (const m of glob.scan({ cwd: root, onlyFiles: true })) matches.push(m)
    } else {
      await walk(root, root, matches)
    }
    matches.sort()
    return matches.length ? matches.join("\n") : "(no matches)"
  },
})

async function walk(dir: string, root: string, out: string[]): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) await walk(full, root, out)
    else out.push(relative(root, full))
  }
}

const grep = defineTool({
  name: "grep",
  description:
    "Search file contents for a regular expression within the workspace using ripgrep. Returns matching lines with file:line prefixes.",
  parameters: z.object({
    pattern: z.string().describe("Regular expression to search for"),
    path: z.string().optional().describe("Subpath to limit the search (within the workspace)"),
  }),
  async execute(args, ctx) {
    const searchPath = resolveInWorkspace(ctx.workspaceRoot, args.path ?? ".")
    const r = spawnSync("rg", ["--line-number", "--no-heading", "--color", "never", args.pattern, searchPath], {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    })
    if (r.error) return `error: ripgrep not available: ${r.error.message}`
    if (r.status === 1) return "(no matches)"
    if (r.status !== 0) return `error: grep failed: ${r.stderr}`
    return r.stdout.split(ctx.workspaceRoot + "/").join("").trim() || "(no matches)"
  },
})

const shell = defineTool({
  name: "shell",
  description:
    "Run a shell command from the workspace root and return its combined output. Use for building, running tests/apps, git, installing packages, etc. Runs natively in the container.",
  parameters: z.object({
    command: z.string().describe("Shell command to run"),
  }),
  async execute(args, ctx) {
    const r = spawnSync("bash", ["-lc", args.command], {
      cwd: ctx.workspaceRoot,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    })
    const out = (r.stdout ?? "") + (r.stderr ?? "")
    const code = r.status ?? (r.error ? 1 : 0)
    return `exit ${code}\n${out}`.trim()
  },
})

export const FILE_TOOLS: AnyTool[] = [read, write, edit, glob, grep, shell]
