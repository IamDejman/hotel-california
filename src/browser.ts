/**
 * Page observation for the agent. We tag every interactive element with a
 * stable ref, then hand the model a compact digest instead of raw HTML.
 * Playwright-compatible page from @solarisdk/browser, typed structurally so we
 * only depend on the methods we call.
 */

export interface AgentPage {
  goto(url: string, opts?: { waitUntil?: "load" | "domcontentloaded" }): Promise<unknown>
  url(): string
  title(): Promise<string>
  evaluate<T>(fn: string | (() => T)): Promise<T>
  click(selector: string, opts?: { timeout?: number }): Promise<void>
  fill(selector: string, value: string, opts?: { timeout?: number }): Promise<void>
  waitForTimeout(ms: number): Promise<void>
}

export interface ObservedElement {
  ref: number
  role: string
  text: string
}

export interface Observation {
  url: string
  title: string
  elements: ObservedElement[]
  visibleText: string
}

export async function observe(page: AgentPage): Promise<Observation> {
  await page.waitForTimeout(600) // let navigations and reflows settle
  // Passed as a string so tsx/esbuild never rewrites it: its injected
  // __name() helper does not exist inside the browser page.
  const raw = await page.evaluate<{ elements: ObservedElement[]; visibleText: string }>(`(() => {
    const selector =
      "a[href], button, input, select, textarea, [role='button'], [role='link'], [onclick]"
    const nodes = Array.from(document.querySelectorAll(selector))
    const elements = nodes
      .filter((el) => {
        const rect = el.getBoundingClientRect()
        const style = window.getComputedStyle(el)
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none"
      })
      .map((el, i) => {
        el.setAttribute("data-hc-ref", String(i))
        const tag = el.tagName.toLowerCase()
        const role =
          tag === "a" ? "link" : tag === "input" ? "input:" + (el.getAttribute("type") ?? "text") : tag
        const label =
          el.innerText?.trim() ||
          el.getAttribute("aria-label") ||
          el.getAttribute("placeholder") ||
          el.getAttribute("value") ||
          ""
        return { ref: i, role, text: label.slice(0, 120) }
      })
    const visibleText = (document.body?.innerText ?? "").replace(/\\n{3,}/g, "\\n\\n").slice(0, 4000)
    return { elements, visibleText }
  })()`)
  return {
    url: page.url(),
    title: await page.title(),
    elements: raw.elements,
    visibleText: raw.visibleText,
  }
}

export function formatObservation(obs: Observation): string {
  const els = obs.elements
    .map((e) => `  [${e.ref}] ${e.role}: ${JSON.stringify(e.text)}`)
    .join("\n")
  return [
    `URL: ${obs.url}`,
    `Title: ${obs.title}`,
    `Interactive elements:\n${els || "  (none)"}`,
    `Visible text:\n${obs.visibleText}`,
  ].join("\n\n")
}

export const refSelector = (ref: number): string => `[data-hc-ref="${ref}"]`
