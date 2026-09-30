/**
 * Hotel California: point an AI agent at a subscription cancellation flow,
 * measure how hard the company fights to keep you, and keep the replay.
 *
 *   npm start -- gym                          attack the bundled Streamly+ dark-pattern gym
 *   npm start -- <service>                    attack a service from services.json (your own account)
 *   npm start -- <service> --regions us,gb,de run the same flow through residential egress in
 *                                             each country and compare what each one is shown
 */
import { readFile, writeFile, mkdir } from "node:fs/promises"
import path from "node:path"
import { Solari } from "@solarisdk/browser"
import { runEscape } from "./agent.js"
import { deployGym, type GymDeployment } from "./gym.js"
import { downloadReplay } from "./replay.js"
import { escapeScore, grade } from "./score.js"
import { buildLeaderboard } from "./report.js"
import type { RunResult } from "./types.js"

interface ServiceConfig {
  startUrl: string
  profile?: string
  proxy?: string
  notes?: string
}

const apiKey = process.env.SOLARI_API_KEY
if (!apiKey) {
  console.error("Set SOLARI_API_KEY (get one at https://console.getsolari.com)")
  process.exit(1)
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.error("Set ANTHROPIC_API_KEY (the agent is driven by Claude)")
  process.exit(1)
}

const args = process.argv.slice(2)
const serviceName = args.find((a) => !a.startsWith("--"))
if (!serviceName) {
  console.error("Usage: npm start -- <service|gym> [--regions us,gb,de]")
  process.exit(1)
}
const service: string = serviceName
const regionsFlag = args.find((a) => a.startsWith("--regions"))
const regions = regionsFlag
  ? (regionsFlag.split("=")[1] ?? args[args.indexOf(regionsFlag) + 1] ?? "")
      .split(",")
      .map((r) => r.trim())
      .filter(Boolean)
  : []

let gym: GymDeployment | null = null
let config: ServiceConfig
if (serviceName === "gym") {
  gym = await deployGym(apiKey)
  // The preview URL carries its access token in the query string, so append
  // the page to the path rather than to the end of the string.
  const start = new URL(gym.url)
  start.pathname = `${start.pathname.replace(/\/$/, "")}/index.html`
  config = { startUrl: start.toString() }
} else {
  const registry = JSON.parse(await readFile("services.json", "utf8")) as Record<
    string,
    ServiceConfig
  >
  const found = registry[serviceName]
  if (!found) {
    console.error(`Unknown service "${serviceName}". Add it to services.json first.`)
    process.exit(1)
  }
  config = found
}

const solari = new Solari({ apiKey })

async function runOnce(region: string | null): Promise<RunResult> {
  const started = Date.now()

  // Persistent profile: log in to the service once by hand (see README), save
  // the profile, and every scored run after that starts already signed in.
  let profileId: string | undefined
  if (config.profile) {
    const profiles = await solari.profiles.list()
    const profile = profiles.find((p) => p.name === config.profile)
    if (!profile) {
      throw new Error(`Profile "${config.profile}" not found. Run the login step first (README).`)
    }
    profileId = profile.id
  }

  const proxy = region ?? config.proxy
  const browser = await solari.launch({
    recording: true, // the receipt: an rrweb replay of the whole escape
    stealth: true,
    ...(proxy ? { proxy } : {}),
    ...(profileId ? { profileId } : {}),
  })
  const regionLabel = region ?? "direct"
  console.log(
    `session ${browser.id}: cancelling "${service}" from ${config.startUrl} (egress: ${regionLabel})`,
  )

  let run
  try {
    const page = await browser.newPage()
    run = await runEscape(page, config.startUrl)
  } finally {
    await browser.close()
  }

  const metrics = {
    clicks: run.clicks,
    keystrokesFields: run.keystrokesFields,
    pagesVisited: run.pagesVisited,
    agentSteps: run.agentSteps,
    durationMs: Date.now() - started,
  }
  const score = escapeScore(metrics, run.patterns)
  const slug = region ? `${service}@${region}` : service
  const replayFile = await downloadReplay(solari.sessions, browser.id, slug)

  return {
    service,
    region: regionLabel,
    startUrl: config.startUrl,
    ranAt: new Date().toISOString(),
    outcome: run.outcome,
    summary: run.summary,
    metrics,
    patterns: run.patterns,
    score,
    grade: grade(score, run.outcome),
    sessionId: browser.id,
    replayFile,
  }
}

const results: RunResult[] = []
try {
  if (regions.length > 0) {
    for (const region of regions) {
      results.push(await runOnce(region))
    }
  } else {
    results.push(await runOnce(null))
  }
} finally {
  await solari.close()
  if (gym) await gym.teardown()
}

await mkdir("results", { recursive: true })
for (const result of results) {
  const slug = result.region === "direct" ? result.service : `${result.service}@${result.region}`
  const outFile = path.join("results", `${slug}.json`)
  await writeFile(outFile, JSON.stringify(result, null, 2) + "\n")

  console.log("")
  console.log(`  region : ${result.region}`)
  console.log(`  outcome : ${result.outcome}`)
  console.log(`  escape score : ${result.score}/100 (grade ${result.grade})`)
  console.log(`  dark patterns : ${result.patterns.length}`)
  for (const p of result.patterns) console.log(`    - ${p.type}: ${p.evidence.slice(0, 90)}`)
  console.log(
    `  clicks ${result.metrics.clicks}, pages ${result.metrics.pagesVisited}, ${Math.round(result.metrics.durationMs / 1000)}s`,
  )
  console.log(`  saved : ${outFile}${result.replayFile ? ` + ${result.replayFile}` : ""}`)
}

await buildLeaderboard()
if (regions.length > 1) {
  const { buildRegionReport } = await import("./compare.js")
  await buildRegionReport(serviceName)
}
