// All agent tools: file/coding tools, container-capability tools, and the
// dynamically-built skill tool (whose description lists the workspace's skills).
import type { AnyTool } from "../tool.ts"
import { FILE_TOOLS } from "./index.ts"
import { SYSTEM_TOOLS } from "./system.ts"
import { buildSkillTool } from "./skill.ts"

/** Static tool set (no workspace-dependent tools). */
export const TOOLS: AnyTool[] = [...FILE_TOOLS, ...SYSTEM_TOOLS]

/** Build the full tool set for a run, including the workspace's skill tool. */
export function buildTools(workspaceRoot: string): AnyTool[] {
  return [...FILE_TOOLS, ...SYSTEM_TOOLS, buildSkillTool(workspaceRoot)]
}

export function toolByName(name: string): AnyTool | undefined {
  return TOOLS.find((t) => t.name === name)
}
