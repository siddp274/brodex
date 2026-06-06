// The `skill` tool: lets the agent load a packaged workflow on demand. Its
// description lists the skills available in the workspace; calling it injects
// that skill's instruction body as the tool result, which the model then
// follows. Built per-run because the available skills depend on the workspace.
import { z } from "zod"
import { defineTool, type AnyTool } from "../tool.ts"
import { listSkills, getSkill } from "../skills.ts"

export function buildSkillTool(workspaceRoot: string): AnyTool {
  const skills = listSkills(workspaceRoot)
  const list = skills.length
    ? skills.map((s) => `- **${s.name}**: ${s.description}`).join("\n")
    : "(no skills are currently available)"
  return defineTool({
    name: "skill",
    description:
      "Load a specialized skill when the task matches one of the available skills below. " +
      "Calling this injects the skill's detailed instructions into the conversation; then follow them.\n\n" +
      "Available skills:\n" +
      list,
    parameters: z.object({
      name: z.string().describe("The name of the skill to load (from the list above)"),
    }),
    async execute(args, ctx) {
      const skill = getSkill(args.name, ctx.workspaceRoot)
      if (!skill) return `error: no skill named "${args.name}"`
      return `# Skill: ${skill.name}\n(directory: ${skill.dir})\n\n${skill.body}`
    },
  })
}
