/**
 * The Escape Score: 100 means "one honest click and you're out",
 * 0 means you can check out any time you like, but you can never leave.
 */
import type { PatternSighting, PatternType, RunMetrics } from "./types.js"

/** Penalty per sighting. Weighted by how coercive the pattern is. */
export const PATTERN_WEIGHTS: Record<PatternType, number> = {
  channel_switch: 25, // "call us to cancel" is the roach motel endgame
  hidden_path: 8,
  retention_offer: 8,
  misdirection: 6,
  confirmshaming: 6,
  guilt_trip: 5,
  price_hike_threat: 5,
  forced_survey: 4,
  fake_urgency: 4,
  artificial_delay: 4,
  repeated_confirmation: 3,
}

export const PATTERN_LABELS: Record<PatternType, string> = {
  channel_switch: "Forced channel switch (call/chat/email to cancel)",
  hidden_path: "Hidden cancellation path",
  retention_offer: "Retention offer wall",
  misdirection: "Visual misdirection (keep-button styled over cancel)",
  confirmshaming: "Confirmshaming button copy",
  guilt_trip: "Guilt-trip screen",
  price_hike_threat: "Threats of losing grandfathered pricing",
  forced_survey: "Mandatory exit survey",
  fake_urgency: "Fake urgency or countdown",
  artificial_delay: "Artificial waiting or fake processing",
  repeated_confirmation: "Repeated are-you-sure confirmations",
}

const FREE_CLICKS = 3 // a fair flow: account, cancel, confirm
const FREE_MS = 2 * 60_000

/** One line on the checkout bill: what it cost the customer, in score points. */
export interface Charge {
  label: string
  points: number
  /** Index into the run's patterns when a dark pattern caused the charge. */
  pattern?: number
}

export function charges(metrics: RunMetrics, patterns: PatternSighting[]): Charge[] {
  const bill: Charge[] = patterns.map((p, i) => ({
    label: PATTERN_LABELS[p.type],
    points: PATTERN_WEIGHTS[p.type],
    pattern: i,
  }))
  const extraClicks = Math.max(0, metrics.clicks - FREE_CLICKS)
  if (extraClicks > 0) {
    bill.push({ label: `${extraClicks} clicks past the first ${FREE_CLICKS}`, points: extraClicks * 2 })
  }
  const extraMinutes = Math.max(0, Math.floor((metrics.durationMs - FREE_MS) / 60_000))
  if (extraMinutes > 0) {
    bill.push({ label: `${extraMinutes} min past the first 2`, points: extraMinutes * 3 })
  }
  return bill
}

export function escapeScore(metrics: RunMetrics, patterns: PatternSighting[]): number {
  const penalty = charges(metrics, patterns).reduce((sum, c) => sum + c.points, 0)
  return Math.max(0, Math.min(100, 100 - penalty))
}

export function grade(score: number, outcome: string): string {
  if (outcome === "blocked" || outcome === "requires_human") return "F"
  if (score >= 90) return "A"
  if (score >= 75) return "B"
  if (score >= 60) return "C"
  if (score >= 40) return "D"
  return "F"
}
