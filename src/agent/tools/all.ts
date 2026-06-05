// All agent tools: file/coding tools plus container-capability tools.
import type { AnyTool } from "../tool.ts"
import { FILE_TOOLS } from "./index.ts"
import { SYSTEM_TOOLS } from "./system.ts"

export const TOOLS: AnyTool[] = [...FILE_TOOLS, ...SYSTEM_TOOLS]

export function toolByName(name: string): AnyTool | undefined {
  return TOOLS.find((t) => t.name === name)
}
