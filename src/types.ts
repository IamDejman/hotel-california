/** Shared types for a cancellation run and its scoring. */

export const PATTERN_TYPES = [
  "hidden_path",
  "retention_offer",
  "confirmshaming",
  "guilt_trip",
  "forced_survey",
  "artificial_delay",
  "fake_urgency",
  "misdirection",
  "repeated_confirmation",
  "channel_switch",
  "price_hike_threat",
] as const

export type PatternType = (typeof PATTERN_TYPES)[number]

export interface PatternSighting {
  type: PatternType
  evidence: string
  url: string
  step: number
  /** Epoch ms when the agent recorded it; aligns markers to the rrweb replay timeline. */
  atMs: number
}

export type Outcome = "cancelled" | "blocked" | "requires_human" | "gave_up"

export interface RunMetrics {
  clicks: number
  keystrokesFields: number
  pagesVisited: number
  agentSteps: number
  durationMs: number
}

export interface RunResult {
  service: string
  /** Human-readable name for reports; falls back to the service key. */
  displayName?: string
  /** Residential proxy egress country for this run, or "direct". */
  region: string
  startUrl: string
  ranAt: string
  outcome: Outcome
  summary: string
  metrics: RunMetrics
  patterns: PatternSighting[]
  score: number
  grade: string
  sessionId: string
  replayFile: string | null
}
