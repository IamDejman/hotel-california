/**
 * Download the rrweb session replay: the receipt that proves what the flow did.
 * Uploads land asynchronously after release, so poll patiently.
 */
import { writeFile, mkdir } from "node:fs/promises"
import { createHash } from "node:crypto"
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
      // Session IDs run to ~250 characters; a short hash keeps names under the 255-byte limit.
      const id = createHash("sha256").update(sessionId).digest("hex").slice(0, 12)
      const file = path.join("replays", `${service}-${id}.ndjson`)
      // Drop sandbox preview tokens from recorded URLs before the replay is published.
      const events = Buffer.from(blob as ArrayBuffer).toString("utf8")
      await writeFile(file, events.replace(/[?&]pt_token=[A-Za-z0-9_.-]+/g, ""))
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
