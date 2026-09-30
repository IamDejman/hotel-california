/** Read scored runs from results/*.json, worst offenders first. */
import { readFile, readdir } from "node:fs/promises"
import path from "node:path"
import type { RunResult } from "./types.js"

const RESULTS_DIR = "results"

export async function loadResults(): Promise<RunResult[]> {
  let files: string[]
  try {
    files = (await readdir(RESULTS_DIR)).filter((f) => f.endsWith(".json"))
  } catch {
    return []
  }
  const results = await Promise.all(
    files.map(async (f) => JSON.parse(await readFile(path.join(RESULTS_DIR, f), "utf8")) as RunResult),
  )
  return results.sort((a, b) => a.score - b.score)
}
