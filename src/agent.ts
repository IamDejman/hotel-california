/**
 * The escape artist: a Claude-driven loop that navigates a cancellation flow,
 * logging every dark pattern it gets hit with along the way.
 */
import Anthropic from "@anthropic-ai/sdk"
import { z } from "zod"
import { observe, formatObservation, refSelector, type AgentPage } from "./browser.js"
import { PATTERN_TYPES, type Outcome, type PatternSighting, type PatternType } from "./types.js"

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-4-6"
const MAX_STEPS = 40

const SYSTEM = `You are an agent cancelling a subscription on the account owner's explicit instructions, on their own account. Your goal is to reach a confirmed cancellation in as few steps as possible while documenting every obstacle.

Rules, non-negotiable:
- Never enter payment details, passwords, or personal data beyond what the flow already shows.
- Never attempt to bypass a CAPTCHA or bot check. If one appears, finish with outcome "requires_human".
- If cancellation genuinely requires a phone call or live chat with a human, record a channel_switch pattern and finish with outcome "blocked". Do not impersonate the owner in a live conversation.
- Do not click anything that upgrades, renews, or purchases.

Dark patterns to record with record_pattern the moment you see one (record each distinct sighting, but the same screen only once):
- hidden_path: the cancel entry point is buried, tiny, low-contrast, or behind unrelated menus
- retention_offer: discounts, free months, or pause offers interposed before you may cancel
- confirmshaming: decline buttons worded to shame you ("No, I hate saving money")
- guilt_trip: emotional appeals about what you will lose
- forced_survey: you cannot proceed without answering why you are leaving
- artificial_delay: fake spinners, "connecting you to a specialist", forced waits
- fake_urgency: countdowns or limited-time framing to stop you leaving
- misdirection: the keep-subscription button visually dominant over the cancel action
- repeated_confirmation: more than one are-you-sure screen
- channel_switch: told to call, chat, or email to finish cancelling
- price_hike_threat: warned you will lose grandfathered pricing forever

Survey questions may be answered minimally and truthfully ("No longer need it"). When cancellation is confirmed on screen, call finish with outcome "cancelled" and quote the confirmation text as evidence.`

const clickInput = z.object({ ref: z.number(), why: z.string() })
const typeInput = z.object({ ref: z.number(), text: z.string() })
const gotoInput = z.object({ url: z.string() })
const patternInput = z.object({
  type: z.enum(PATTERN_TYPES),
  evidence: z.string(),
})
const finishInput = z.object({
  outcome: z.enum(["cancelled", "blocked", "requires_human", "gave_up"]),
  summary: z.string(),
})

const TOOLS: Anthropic.Tool[] = [
  {
    name: "click",
    description: "Click the element with the given ref from the latest observation.",
    input_schema: {
      type: "object",
      properties: { ref: { type: "number" }, why: { type: "string" } },
      required: ["ref", "why"],
    },
  },
  {
    name: "type_text",
    description: "Fill the input element with the given ref with text.",
    input_schema: {
      type: "object",
      properties: { ref: { type: "number" }, text: { type: "string" } },
      required: ["ref", "text"],
    },
  },
  {
    name: "goto",
    description: "Navigate directly to a URL on the same site.",
    input_schema: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
    },
  },
  {
    name: "record_pattern",
    description: "Log a dark pattern you are looking at right now, with a short quote as evidence.",
    input_schema: {
      type: "object",
      properties: {
        type: { type: "string", enum: [...PATTERN_TYPES] },
        evidence: { type: "string" },
      },
      required: ["type", "evidence"],
    },
  },
  {
    name: "finish",
    description: "End the run with a final outcome and a one-paragraph summary.",
    input_schema: {
      type: "object",
      properties: {
        outcome: { type: "string", enum: ["cancelled", "blocked", "requires_human", "gave_up"] },
        summary: { type: "string" },
      },
      required: ["outcome", "summary"],
    },
  },
]

export interface AgentRun {
  outcome: Outcome
  summary: string
  patterns: PatternSighting[]
  clicks: number
  keystrokesFields: number
  pagesVisited: number
  agentSteps: number
}

export async function runEscape(page: AgentPage, startUrl: string): Promise<AgentRun> {
  const client = new Anthropic()
  const run: AgentRun = {
    outcome: "gave_up",
    summary: "Agent ran out of steps before reaching a terminal state.",
    patterns: [],
    clicks: 0,
    keystrokesFields: 0,
    pagesVisited: 1,
    agentSteps: 0,
  }
  const seenUrls = new Set<string>([startUrl])

  await page.goto(startUrl)
  const first = await observe(page)
  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `Cancel the subscription starting from this page.\n\n${formatObservation(first)}`,
    },
  ]

  while (run.agentSteps < MAX_STEPS) {
    run.agentSteps++
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      system: SYSTEM,
      tools: TOOLS,
      messages,
    })
    const response = await stream.finalMessage()
    messages.push({ role: "assistant", content: response.content })

    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    )
    if (toolUses.length === 0) break

    const results: Anthropic.ToolResultBlockParam[] = []
    let finished = false
    for (const tool of toolUses) {
      const result = await execute(tool, page, run, seenUrls)
      results.push({ type: "tool_result", tool_use_id: tool.id, content: result.text })
      if (result.finished) finished = true
    }
    messages.push({ role: "user", content: results })
    if (finished) return run
  }
  return run
}

async function execute(
  tool: Anthropic.ToolUseBlock,
  page: AgentPage,
  run: AgentRun,
  seenUrls: Set<string>,
): Promise<{ text: string; finished: boolean }> {
  const step = run.agentSteps
  try {
    switch (tool.name) {
      case "click": {
        const { ref, why } = clickInput.parse(tool.input)
        console.log(`  step ${step}: click [${ref}] (${why})`)
        await page.click(refSelector(ref), { timeout: 10_000 })
        run.clicks++
        return { text: await reobserve(page, run, seenUrls), finished: false }
      }
      case "type_text": {
        const { ref, text } = typeInput.parse(tool.input)
        console.log(`  step ${step}: type into [${ref}]`)
        await page.fill(refSelector(ref), text, { timeout: 10_000 })
        run.keystrokesFields++
        return { text: await reobserve(page, run, seenUrls), finished: false }
      }
      case "goto": {
        const { url } = gotoInput.parse(tool.input)
        console.log(`  step ${step}: goto ${url}`)
        await page.goto(url)
        return { text: await reobserve(page, run, seenUrls), finished: false }
      }
      case "record_pattern": {
        const { type, evidence } = patternInput.parse(tool.input)
        console.log(`  step ${step}: DARK PATTERN ${type}: ${evidence.slice(0, 80)}`)
        run.patterns.push({
          type: type as PatternType,
          evidence,
          url: page.url(),
          step,
          atMs: Date.now(),
        })
        return { text: `Recorded ${type}.`, finished: false }
      }
      case "finish": {
        const { outcome, summary } = finishInput.parse(tool.input)
        run.outcome = outcome
        run.summary = summary
        console.log(`  step ${step}: FINISH (${outcome})`)
        return { text: "Run complete.", finished: true }
      }
      default:
        return { text: `Unknown tool ${tool.name}.`, finished: false }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.log(`  step ${step}: ${tool.name} failed: ${message.split("\n")[0]}`)
    return { text: `Action failed: ${message.split("\n")[0]}. Observe and try another element.`, finished: false }
  }
}

async function reobserve(page: AgentPage, run: AgentRun, seenUrls: Set<string>): Promise<string> {
  const obs = await observe(page)
  if (!seenUrls.has(obs.url)) {
    seenUrls.add(obs.url)
    run.pagesVisited++
  }
  return formatObservation(obs)
}
