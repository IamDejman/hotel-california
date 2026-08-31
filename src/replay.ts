/**
 * Download the rrweb session replay: the receipt that proves what the flow
 * actually did. Uploads land asynchronously after release, so poll patiently.
 */
import { writeFile, mkdir } from "node:fs/promises"
import path from "node:path"

interface SessionsApi {
  downloadReplay(sessionId: string): Promise<ArrayBuffer | Uint8Array | Buffer>
}

export async function downloadReplay(
  sessions: SessionsApi,
  sessionId: string,
  service: string,
): Promise<string | null> {
  for (let attempt = 1; attempt <= 10; attempt++) {
    await new Promise((r) => setTimeout(r, 3000))
    try {
      const blob = await sessions.downloadReplay(sessionId)
      await mkdir("replays", { recursive: true })
      const file = path.join("replays", `${service}-${sessionId}.ndjson`)
      await writeFile(file, Buffer.from(blob as ArrayBuffer))
      return file
    } catch (err) {
      const status = (err as { status?: number }).status
      if (status === 404) continue // not uploaded yet, keep polling
      throw err
    }
  }
  console.warn("replay never appeared after ~30s; continuing without it")
  return null
}
