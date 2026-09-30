/**
 * Deploy the Streamly+ gym into a Solari sandbox and expose it on a public
 * preview URL, so the cloud browser (which cannot see your localhost) can
 * reach it. One API key runs both halves of the demo.
 */
import { readFile, readdir } from "node:fs/promises"
import path from "node:path"
import { SolariClient } from "@solarisdk/sdk"

const PORT = 8080

export interface GymDeployment {
  url: string
  teardown(): Promise<void>
}

export async function deployGym(apiKey: string): Promise<GymDeployment> {
  const client = new SolariClient({ apiKey })
  const sandbox = await client.sandboxes.create({ template: "base", timeoutMs: 10 * 60_000 })
  console.log("gym sandbox:", sandbox.sandboxId)
  try {
    await sandbox.connect()
    const gymDir = path.join(process.cwd(), "gym")
    // Inline the stylesheet so the session replay keeps the styling after the
    // sandbox (and its style.css) is gone. Visual misdirection is a scored pattern.
    const css = await readFile(path.join(gymDir, "style.css"), "utf8")
    for (const file of await readdir(gymDir)) {
      const content = await readFile(path.join(gymDir, file), "utf8")
      const served = file.endsWith(".html")
        ? content.replace('<link rel="stylesheet" href="style.css">', `<style>${css}</style>`)
        : content
      await sandbox.files.write(`/tmp/gym/${file}`, served)
    }
    await sandbox.commands.run("sh", {
      args: ["-c", `cd /tmp/gym && nohup python3 -m http.server ${PORT} >/dev/null 2>&1 &`],
    })
    const { url } = await sandbox.previewUrl(PORT)

    // Wait until the preview serves before pointing an agent at it.
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 1000))
      try {
        const res = await fetch(url)
        if (res.ok) break
      } catch {
        // gateway not ready yet, keep waiting
      }
    }
    console.log("gym is live:", url)
    return { url, teardown: () => sandbox.kill() }
  } catch (err) {
    await sandbox.kill()
    throw err
  }
}
