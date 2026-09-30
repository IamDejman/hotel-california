/**
 * The model behind the agent. Anthropic by default; with AI_PROVIDER=openai,
 * any OpenAI-compatible API (OpenAI, Gemini, OpenRouter, Groq, a local Ollama).
 * Tools are declared once as zod schemas and converted for whichever provider runs.
 */
import Anthropic from "@anthropic-ai/sdk"
import OpenAI from "openai"
import type { AnyZodObject } from "zod"
import { zodToJsonSchema } from "zod-to-json-schema"

export const PROVIDER = process.env.AI_PROVIDER ?? "anthropic"
export const MODEL =
  process.env.AI_MODEL ?? (PROVIDER === "anthropic" ? (process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5") : "")

export interface ToolSpec {
  name: string
  description: string
  input: AnyZodObject
}

export interface ToolCall {
  id: string
  name: string
  input: unknown
}

/** One conversation with the model, whatever the provider. */
export interface Chat {
  /** Send the conversation so far and return the tool calls in the reply. */
  next(): Promise<ToolCall[]>
  /** Answer the last reply's tool calls. */
  answer(results: { id: string; text: string }[]): void
  /** Add a plain user message. */
  say(text: string): void
}

/** Why the model can't be reached with the current environment, or null if it can. */
export function configError(): string | null {
  if (PROVIDER === "anthropic") {
    return process.env.ANTHROPIC_API_KEY
      ? null
      : "Set ANTHROPIC_API_KEY, or set AI_PROVIDER=openai to use another model (see README)"
  }
  if (PROVIDER === "openai") {
    if (!process.env.OPENAI_API_KEY) return "Set OPENAI_API_KEY (and OPENAI_BASE_URL for providers other than OpenAI)"
    if (!MODEL) return "Set AI_MODEL to the model name your provider uses"
    return null
  }
  return `Unknown AI_PROVIDER "${PROVIDER}". Use anthropic or openai.`
}

export function startChat(system: string, tools: ToolSpec[], first: string): Chat {
  return PROVIDER === "openai" ? openaiChat(system, tools, first) : anthropicChat(system, tools, first)
}

function jsonSchema(schema: AnyZodObject): Record<string, unknown> {
  const json = zodToJsonSchema(schema, { $refStrategy: "none" }) as Record<string, unknown>
  delete json.$schema
  return json
}

function anthropicChat(system: string, tools: ToolSpec[], first: string): Chat {
  const client = new Anthropic()
  const defs: Anthropic.Tool[] = tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: jsonSchema(t.input) as Anthropic.Tool.InputSchema,
  }))
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: first }]
  return {
    async next() {
      const response = await client.messages
        .stream({ model: MODEL, max_tokens: 16000, thinking: { type: "adaptive" }, system, tools: defs, messages })
        .finalMessage()
      messages.push({ role: "assistant", content: response.content })
      return response.content
        .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
        .map((b) => ({ id: b.id, name: b.name, input: b.input }))
    },
    answer(results) {
      messages.push({
        role: "user",
        content: results.map((r) => ({ type: "tool_result", tool_use_id: r.id, content: r.text })),
      })
    },
    say(text) {
      messages.push({ role: "user", content: text })
    },
  }
}

function openaiChat(system: string, tools: ToolSpec[], first: string): Chat {
  const client = new OpenAI() // reads OPENAI_API_KEY and OPENAI_BASE_URL
  const defs: OpenAI.Chat.ChatCompletionTool[] = tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: jsonSchema(t.input) },
  }))
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: system },
    { role: "user", content: first },
  ]
  return {
    async next() {
      const response = await client.chat.completions.create({ model: MODEL, messages, tools: defs })
      const message = response.choices[0]?.message
      if (!message) return []
      const calls = (message.tool_calls ?? []).filter((c) => c.type === "function")
      messages.push({ role: "assistant", content: message.content, tool_calls: calls })
      return calls.map((c) => ({ id: c.id, name: c.function.name, input: parseArgs(c.function.arguments) }))
    },
    answer(results) {
      for (const r of results) messages.push({ role: "tool", tool_call_id: r.id, content: r.text })
    },
    say(text) {
      messages.push({ role: "user", content: text })
    },
  }
}

/** Malformed arguments become {}, which fails validation and is reported back to the model. */
function parseArgs(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}
