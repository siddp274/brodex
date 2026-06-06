// The agent loop: call model -> run any tool calls -> feed results back -> loop
// until the model stops requesting tools (or we hit the step cap). Plain async,
// no framework. Emits events so a TUI (Phase 2) or a headless runner can render.
import type { Message, Provider } from "./types.ts"
import { type AnyTool, runTool, toToolDefinition, type ToolContext } from "./tool.ts"
import { type Approver, type Mode, SessionGrants, resolveEffect } from "./permission.ts"
import { runHooks, beforeEventFor, afterEventFor } from "./hooks.ts"

export interface LoopEvent {
  type: "assistant_text" | "tool_call" | "tool_result" | "done" | "error" | "denied"
  text?: string
  toolName?: string
  toolArgs?: string
  toolResult?: string
}

export interface RunOptions {
  provider: Provider
  tools: AnyTool[]
  system: string
  /** New user prompt for this run. */
  prompt: string
  /** Optional images attached to this prompt (vision input). */
  images?: { url: string }[]
  ctx: ToolContext
  /** Prior conversation to continue (from a resumed session). Empty for new. */
  history?: Message[]
  /** Max model turns before bailing (prevents runaway loops). */
  maxSteps?: number
  /** Permission mode for this run. Defaults to "ask". */
  mode?: Mode
  /** Session grants ("allow for session") shared across runs in a session. */
  grants?: SessionGrants
  /** Asked when a tool call resolves to "ask". Required unless mode is "full". */
  approver?: Approver
  /** Called for each event so callers can render progressively. */
  onEvent?: (e: LoopEvent) => void
  /** Called whenever the message list changes, so callers can persist it. */
  onPersist?: (messages: Message[]) => void
  /** Called after each model turn with that turn's token usage, if reported. */
  onUsage?: (usage: { inputTokens: number; outputTokens: number }) => void
}

export async function run(opts: RunOptions): Promise<Message[]> {
  const { provider, tools, system, prompt, ctx } = opts
  const maxSteps = opts.maxSteps ?? 25
  const mode: Mode = opts.mode ?? "ask"
  const grants = opts.grants ?? new SessionGrants()
  const emit = (e: LoopEvent) => opts.onEvent?.(e)
  const persist = (m: Message[]) => opts.onPersist?.(m)

  // Surface hook output as note events so the user sees what ran.
  const emitHooks = (results: ReturnType<typeof runHooks>, e: typeof emit) => {
    for (const h of results) {
      e({ type: "tool_result", toolName: `hook:${h.event}`, toolResult: `$ ${h.command}\n${h.output || "(no output)"}` })
    }
  }

  // Decide whether a tool call may run. Returns the tool result string if the
  // call was blocked (denied), or undefined if it may proceed.
  async function gate(toolName: string, args: string): Promise<string | undefined> {
    const effect = resolveEffect(toolName, mode, grants)
    if (effect === "allow") return undefined
    if (effect === "deny") {
      emit({ type: "denied", toolName, toolResult: "denied by read-only mode" })
      return `denied: "${toolName}" is not permitted in read-only mode`
    }
    // effect === "ask"
    if (!opts.approver) {
      return `denied: "${toolName}" requires approval but no approver is available`
    }
    const decision = await opts.approver({ toolName, args, mode })
    if (decision === "deny") {
      emit({ type: "denied", toolName, toolResult: "denied by user" })
      return `denied: the user declined to run "${toolName}"`
    }
    if (decision === "allow-session") grants.grant(toolName)
    return undefined
  }

  const toolDefs = tools.map(toToolDefinition)
  // Continue prior history (if resuming) and append the new prompt.
  const messages: Message[] = [
    ...(opts.history ?? []),
    { role: "user", content: prompt, images: opts.images && opts.images.length ? opts.images : undefined },
  ]
  persist(messages)

  for (let step = 0; step < maxSteps; step++) {
    const res = await provider.generate({ system, messages, tools: toolDefs })

    // Report token usage for this turn so callers can accumulate it.
    if (res.usage && opts.onUsage) {
      opts.onUsage({
        inputTokens: res.usage.inputTokens ?? 0,
        outputTokens: res.usage.outputTokens ?? 0,
      })
    }

    // Record the assistant turn (text + any tool calls).
    messages.push({
      role: "assistant",
      content: res.text || undefined,
      toolCalls: res.toolCalls.length ? res.toolCalls : undefined,
    })
    persist(messages)
    if (res.text) emit({ type: "assistant_text", text: res.text })

    // No tool calls -> the model is done.
    if (res.toolCalls.length === 0) {
      emitHooks(runHooks("after_run", { workspaceRoot: ctx.workspaceRoot }), emit)
      emit({ type: "done" })
      return messages
    }

    // Run each requested tool and append its result, gated by permissions.
    for (const call of res.toolCalls) {
      emit({ type: "tool_call", toolName: call.name, toolArgs: call.arguments })
      const tool = tools.find((t) => t.name === call.name)

      let result: string
      if (!tool) {
        result = `error: unknown tool "${call.name}"`
      } else {
        const blocked = await gate(call.name, call.arguments)
        if (blocked) {
          result = blocked
        } else {
          // before-hooks (e.g. before_shell).
          const beforeEvent = beforeEventFor(call.name)
          if (beforeEvent) emitHooks(runHooks(beforeEvent, { workspaceRoot: ctx.workspaceRoot, toolName: call.name }), emit)
          result = await runTool(tool, call.arguments, ctx)
          // after-hooks (e.g. after_write / after_edit).
          const afterEvent = afterEventFor(call.name)
          if (afterEvent) emitHooks(runHooks(afterEvent, { workspaceRoot: ctx.workspaceRoot, toolName: call.name }), emit)
        }
      }

      emit({ type: "tool_result", toolName: call.name, toolResult: result })
      messages.push({ role: "tool", toolCallId: call.id, toolResult: result })
    }
    persist(messages)
  }

  emit({ type: "error", text: `stopped after ${maxSteps} steps without completion` })
  return messages
}
