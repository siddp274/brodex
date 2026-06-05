// Tool abstraction. A tool is a name + description + Zod schema + an execute
// function. We convert the Zod schema to JSON Schema for the model, and validate
// the model's arguments against it before executing.
import { z } from "zod"
import { zodToJsonSchema } from "./json-schema.ts"
import type { ToolDefinition } from "./types.ts"

export interface ToolContext {
  /**
   * The workspace root INSIDE the container (e.g. /workspace). Tools execute in
   * the container via the exec backend; this bounds file operations.
   */
  workspaceRoot: string
}

export interface Tool<S extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string
  description: string
  parameters: S
  execute: (args: z.infer<S>, ctx: ToolContext) => Promise<string>
}

/**
 * A tool whose specific schema is erased — used when holding many tools
 * together in an array. `Tool<S>` is invariant in S (S appears in both a field
 * and a function parameter), so narrow tools don't assign to `Tool<ZodTypeAny>`;
 * this erased shape is what collections use.
 */
export interface AnyTool {
  name: string
  description: string
  parameters: z.ZodTypeAny
  execute: (args: any, ctx: ToolContext) => Promise<string>
}

/**
 * Define a tool with full inference in the execute body, returning the erased
 * `AnyTool` so it can live alongside other tools in an array.
 */
export function defineTool<S extends z.ZodTypeAny>(tool: Tool<S>): AnyTool {
  return tool as AnyTool
}

/** Convert a tool to the model-facing definition (JSON Schema parameters). */
export function toToolDefinition(tool: AnyTool): ToolDefinition {
  return {
    name: tool.name,
    description: tool.description,
    parameters: zodToJsonSchema(tool.parameters),
  }
}

/** Validate raw JSON arguments against the tool's schema, then execute. */
export async function runTool(tool: AnyTool, rawArgs: string, ctx: ToolContext): Promise<string> {
  let parsed: unknown
  try {
    parsed = rawArgs.trim() === "" ? {} : JSON.parse(rawArgs)
  } catch {
    return `error: tool "${tool.name}" received invalid JSON arguments`
  }
  const result = tool.parameters.safeParse(parsed)
  if (!result.success) {
    return `error: invalid arguments for "${tool.name}": ${result.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ")}`
  }
  try {
    return await tool.execute(result.data, ctx)
  } catch (e) {
    return `error: tool "${tool.name}" failed: ${(e as Error).message}`
  }
}
