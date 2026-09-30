import { test } from "node:test"
import assert from "node:assert/strict"
import { charges, escapeScore, grade } from "../src/score.js"
import { quoteOf } from "../src/site.js"
import type { PatternSighting, PatternType, RunMetrics } from "../src/types.js"

const metrics = (over: Partial<RunMetrics> = {}): RunMetrics => ({
  clicks: 3,
  keystrokesFields: 0,
  pagesVisited: 3,
  agentSteps: 4,
  durationMs: 30_000,
  ...over,
})

const seen = (...types: PatternType[]): PatternSighting[] =>
  types.map((type, step) => ({ type, evidence: "", url: "", step, atMs: 0 }))

test("a clean three-click exit scores 100 and an A", () => {
  assert.deepEqual(charges(metrics(), []), [])
  assert.equal(escapeScore(metrics(), []), 100)
  assert.equal(grade(100, "cancelled"), "A")
})

test("each dark pattern is billed at its weight", () => {
  const bill = charges(metrics(), seen("hidden_path", "confirmshaming", "repeated_confirmation"))
  assert.deepEqual(
    bill.map((c) => [c.points, c.pattern]),
    [[8, 0], [6, 1], [3, 2]],
  )
  assert.equal(escapeScore(metrics(), seen("hidden_path", "confirmshaming", "repeated_confirmation")), 83)
})

test("extra clicks and minutes are billed after the free allowance", () => {
  const bill = charges(metrics({ clicks: 8, durationMs: 4.5 * 60_000 }), [])
  assert.deepEqual(bill.map((c) => c.points), [10, 6])
})

test("the published gym run adds up to 26", () => {
  const patterns = seen(
    "hidden_path", "retention_offer", "forced_survey", "retention_offer", "fake_urgency",
    "misdirection", "guilt_trip", "confirmshaming", "repeated_confirmation",
    "artificial_delay", "price_hike_threat", "repeated_confirmation",
  )
  assert.equal(escapeScore(metrics({ clicks: 8, durationMs: 114_624 }), patterns), 26)
})

test("the score never drops below 0", () => {
  assert.equal(escapeScore(metrics(), seen(...Array(5).fill("channel_switch"))), 0)
})

test("not getting out is an F whatever the score", () => {
  assert.equal(grade(95, "blocked"), "F")
  assert.equal(grade(95, "requires_human"), "F")
  assert.equal(grade(100, "gave_up"), "F")
  assert.equal(grade(62, "cancelled"), "C")
})

test("quoteOf keeps the quoted page text and drops the agent's commentary", () => {
  assert.equal(quoteOf('"Are you absolutely sure?" - yet another confirmation screen'), "Are you absolutely sure?")
  assert.equal(quoteOf("Cancel link is buried in the footer"), "Cancel link is buried in the footer")
})
