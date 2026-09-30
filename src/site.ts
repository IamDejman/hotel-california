/**
 * The Replay Theater: builds a static site (site/) from results/*.json. Each run
 * gets a checkout bill (every dark pattern is an itemized charge against the
 * Escape Score) and an embedded rrweb replay with each charge pinned to its
 * moment on the timeline. Publish site/ anywhere static (GitHub Pages works).
 *
 *   npm run site                       relative links only
 *   SITE_URL=https://you.github.io/hc npm run site   adds link-preview tags
 */
import { copyFile, mkdir, writeFile, access } from "node:fs/promises"
import path from "node:path"
import { loadResults } from "./results.js"
import { charges, PATTERN_LABELS } from "./score.js"
import type { RunResult } from "./types.js"

const RRWEB_CSS = "https://cdn.jsdelivr.net/npm/rrweb-player@1.0.0-alpha.4/dist/style.css"
const RRWEB_JS = "https://cdn.jsdelivr.net/npm/rrweb-player@1.0.0-alpha.4/dist/index.js"
const SITE_URL = process.env.SITE_URL?.replace(/\/$/, "")

const CSS = `
* { margin: 0; box-sizing: border-box; }
:root {
  color-scheme: light dark;
  --bg: #ffffff; --text: #111111; --muted: #666666; --line: #e6e6e6; --panel: #f5f5f5;
  --good: #1a7f37; --mid: #9a6700; --bad: #c62828;
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #0f0f0f; --text: #ededed; --muted: #a0a0a0; --line: #2a2a2a; --panel: #1a1a1a; --good: #57c279; --mid: #d8a93b; --bad: #ff7b72; }
}
body { background: var(--bg); color: var(--text); font: 16px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; }
a { color: inherit; text-underline-offset: 3px; text-decoration-color: var(--muted); }
a:hover { text-decoration-color: currentColor; }
:focus-visible { outline: 2px solid var(--text); outline-offset: 3px; border-radius: 4px; }
.wrap { max-width: 720px; margin: 0 auto; padding: 0 16px; }
header.site { padding: 64px 0 32px; }
.title { font-size: clamp(32px, 7vw, 44px); font-weight: 700; letter-spacing: -0.02em; line-height: 1.1; text-wrap: balance; }
header.site p { color: var(--muted); max-width: 60ch; margin-top: 12px; font-size: 18px; text-wrap: pretty; }
.cta { display: inline-block; margin-top: 24px; background: var(--text); color: var(--bg); padding: 10px 18px; border-radius: 8px; font-weight: 600; text-decoration: none; }
.cta:hover { opacity: 0.85; }
header.site .alt { font-size: 15px; margin-top: 14px; }
html { scroll-behavior: smooth; }
@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }
.back { display: inline-block; margin-bottom: 20px; font-size: 14px; }
h1.run { font-size: 30px; line-height: 1.2; letter-spacing: -0.01em; text-wrap: balance; overflow-wrap: anywhere; }
h2 { font-size: 18px; margin: 48px 0 12px; }
.num { font-variant-numeric: tabular-nums; }
.prose { color: var(--muted); max-width: 65ch; margin: 8px 0; }
.steps { padding-left: 1.3em; color: var(--muted); }
.steps li { margin: 10px 0; max-width: 65ch; padding-left: 4px; }
.steps strong { color: var(--text); font-weight: 600; }
pre { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 14px 16px; overflow-x: auto; font-size: 14px; line-height: 1.6; margin: 12px 0; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.92em; }

.register { list-style: none; padding: 0; border-top: 1px solid var(--line); }
.register a { display: grid; grid-template-columns: 80px 1fr; gap: 20px; padding: 20px 8px; border-bottom: 1px solid var(--line); text-decoration: none; }
.register a:hover { background: var(--panel); }
.register .score { font-size: 40px; font-weight: 700; line-height: 1; letter-spacing: -0.02em; }
.register .grade { font-size: 13px; color: var(--muted); margin-top: 6px; }
.register h3 { font-size: 18px; margin: 0; overflow-wrap: anywhere; }
.register p { color: var(--muted); font-size: 14px; margin-top: 4px; }
.register .go { display: inline-block; margin-top: 8px; font-size: 14px; font-weight: 600; text-decoration: underline; text-underline-offset: 3px; }
.grade-A, .grade-B { color: var(--good); }
.grade-C, .grade-D { color: var(--mid); }
.grade-F { color: var(--bad); }

.facts { display: flex; flex-wrap: wrap; gap: 12px 32px; margin: 20px 0 8px; }
.facts dt { font-size: 13px; color: var(--muted); }
.facts dd { font-size: 22px; font-weight: 700; }
.facts .score dd { font-size: 30px; line-height: 1.1; letter-spacing: -0.02em; }

.player-shell { margin: 28px 0 8px; }
#player { min-height: 120px; }
#player .rr-player { max-width: 100%; background: var(--panel); box-shadow: none; border: 1px solid var(--line); }
#player .rr-controller { background: var(--panel); color: var(--text); }
#player .rr-timeline__time { color: var(--muted); }
#player .rr-progress__handler, #player .switch input[type="checkbox"]:checked + label::before { background: var(--text); }
#player .rr-progress__step { background: var(--line); }
#player .rr-controller__btns button { color: var(--text); }
#player .rr-controller__btns button.active { background: var(--text); color: var(--bg); }
.player-note { color: var(--muted); font-size: 14px; margin-top: 10px; }
.rr-progress { position: relative; }
.marker { position: absolute; top: -9px; width: 20px; height: 24px; margin-left: -10px; padding: 0; border: 0; background: none; cursor: pointer; z-index: 5; touch-action: manipulation; }
.marker::before { content: ""; position: absolute; left: 6px; top: 5px; width: 8px; height: 14px; border-radius: 2px; background: var(--bad); }
.marker:hover::before { background: var(--text); }

.bill { width: 100%; border-collapse: collapse; }
.bill th { text-align: left; font-size: 13px; font-weight: 600; color: var(--muted); padding: 8px 0; border-bottom: 1px solid var(--line); }
.bill td { padding: 14px 0; border-bottom: 1px solid var(--line); vertical-align: top; }
.bill .pts { text-align: right; white-space: nowrap; padding-left: 16px; font-variant-numeric: tabular-nums; }
.bill .charge { font-weight: 600; }
.bill .quote { color: var(--muted); font-size: 14px; margin-top: 4px; overflow-wrap: anywhere; }
.bill button { margin-top: 8px; background: none; border: 1px solid var(--line); color: var(--text); border-radius: 6px; padding: 4px 12px; font: inherit; font-size: 13px; cursor: pointer; touch-action: manipulation; }
.bill button:hover { border-color: var(--text); }
.bill tfoot td { border-bottom: 0; padding-top: 10px; }
.bill tfoot tr:last-child td { border-top: 2px solid var(--text); padding-top: 14px; font-size: 20px; font-weight: 700; }
.report { margin-top: 32px; color: var(--muted); }
.report summary { cursor: pointer; color: var(--text); font-weight: 600; }
.report p { margin-top: 10px; max-width: 65ch; }
.session { font-size: 13px; overflow-wrap: anywhere; }
footer.site { color: var(--muted); font-size: 13px; padding-block: 48px; }
@media (max-width: 520px) { .register a { grid-template-columns: 64px 1fr; gap: 14px; } .register .score { font-size: 32px; } }
`

const PLAYER_SCRIPT = `
const run = JSON.parse(document.getElementById("run-data").textContent);
const mount = document.getElementById("player");
const motion = matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";

async function boot() {
  const res = await fetch(run.replay);
  if (!res.ok) throw new Error("replay request failed: " + res.status);
  const events = (await res.text()).split("\\n").filter(Boolean).map((l) => JSON.parse(l));
  if (events.length < 2) throw new Error("replay is empty");
  const start = events[0].timestamp;
  const span = events[events.length - 1].timestamp - start;
  const width = mount.clientWidth;
  const player = new rrwebPlayer({
    target: mount,
    props: { events, autoPlay: false, width, height: Math.round(width * 0.62) },
  });
  // Open on the first real page instead of the blank tab the browser starts on.
  const firstPage = events.find((e) => e.type === 4 && String(e.data.href).startsWith("http"));
  if (firstPage) player.goto(firstPage.timestamp - start + 50, false);

  const offsets = run.marks.map((m) => Math.max(0, Math.min(m.atMs - start, span)));
  const watch = (i) => {
    player.goto(offsets[i], true);
    mount.scrollIntoView({ behavior: motion, block: "center" });
  };
  const bar = await waitFor(".rr-progress");
  offsets.forEach((off, i) => {
    const m = document.createElement("button");
    m.className = "marker";
    m.type = "button";
    m.title = run.marks[i].label;
    m.setAttribute("aria-label", "Jump to: " + run.marks[i].label);
    m.style.left = (off / span) * 100 + "%";
    m.addEventListener("click", (e) => { e.stopPropagation(); watch(i); });
    bar.appendChild(m);
  });
  document.querySelectorAll("[data-mark]").forEach((btn) => {
    btn.hidden = false;
    btn.addEventListener("click", () => watch(Number(btn.dataset.mark)));
  });
}

function waitFor(selector) {
  return new Promise((resolve) => {
    const tick = () => { const el = document.querySelector(selector); el ? resolve(el) : requestAnimationFrame(tick); };
    tick();
  });
}

boot().catch((err) => {
  console.error(err);
  const note = document.createElement("p");
  note.className = "player-note";
  note.textContent = "The replay did not load (" + err.message + "). Reload the page to try again.";
  mount.replaceChildren(note);
});
`

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

/** The quoted page text in an agent's evidence note, or the whole note when it quotes nothing. */
export const quoteOf = (evidence: string): string => evidence.match(/"([^"]+)"/)?.[1] ?? evidence

/** Agent-written text, with the model's em dashes set as plain hyphens. */
const prose = (s: string): string => esc(s.replace(/\s*\u2014\s*/g, " - "))

const slugOf = (r: RunResult): string => (r.region === "direct" ? r.service : `${r.service}@${r.region}`)

const nameOf = (r: RunResult): string => r.displayName ?? r.service

const regionSuffix = (r: RunResult): string => (r.region === "direct" ? "" : ` from ${r.region.toUpperCase()}`)

const dateOf = (iso: string): string => new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(iso))

const seconds = (r: RunResult): number => Math.round(r.metrics.durationMs / 1000)

const OUTCOME_LABELS: Record<RunResult["outcome"], string> = {
  cancelled: "Cancelled",
  blocked: "Blocked",
  requires_human: "Needs a human",
  gave_up: "Agent gave up",
}

interface Page {
  title: string
  description: string
  /** Path of this page relative to the site root, for link-preview URLs. */
  path: string
  body: string
  extraHead?: string
}

function shell(page: Page): string {
  const preview = SITE_URL
    ? `<meta property="og:url" content="${SITE_URL}/${page.path}">
<meta property="og:image" content="${SITE_URL}/og.png">
<meta name="twitter:card" content="summary_large_image">`
    : ""
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0f0f0f" media="(prefers-color-scheme: dark)">
<title>${esc(page.title)}</title>
<meta name="description" content="${esc(page.description)}">
<meta property="og:title" content="${esc(page.title)}">
<meta property="og:description" content="${esc(page.description)}">
<meta property="og:type" content="website">
${preview}
<style>${CSS}</style>
${page.extraHead ?? ""}
</head>
<body>
<main class="wrap">
${page.body}
</main>
<footer class="site wrap">Built on <a href="https://getsolari.com">Solari</a>. <a href="https://github.com/IamDejman/hotel-california">Source</a></footer>
</body>
</html>
`
}

function indexPage(results: RunResult[]): string {
  const rows = results
    .map((r) => {
      return `<li><a href="runs/${esc(slugOf(r))}.html">
  <div><div class="score num grade-${r.grade}">${r.score}</div><div class="grade">Grade ${r.grade}</div></div>
  <div>
    <h3>${esc(nameOf(r))}${esc(regionSuffix(r))}</h3>
    <p>${OUTCOME_LABELS[r.outcome]}. ${r.patterns.length} dark patterns in ${seconds(r)}s.</p>
    <span class="go">Watch the replay and see the bill</span>
  </div>
</a></li>`
    })
    .join("\n")
  const top = results[0]
  const watch = top ? `\n  <p class="alt">Or <a href="runs/${esc(slugOf(top))}.html">watch a run first</a>.</p>` : ""
  const body = `<header class="site">
  <h1 class="title">Hotel California</h1>
  <p>We send an AI agent to cancel a subscription and score how hard the company makes it to leave.</p>
  <a class="cta" href="#run">Run it yourself</a>${watch}
</header>
<section id="run">
  <h2>Run it yourself</h2>
  <p class="prose">You need Node 22 or newer, a Solari API key, and a key for the AI model. Claude Sonnet 5.5 is the default. Any model with tool calling works through an OpenAI-compatible API. The <a href="https://github.com/IamDejman/hotel-california#choosing-a-model">README</a> shows how.</p>
  <pre><code>git clone https://github.com/IamDejman/hotel-california
cd hotel-california
npm install
cp .env.example .env   # add your keys
npm start -- gym       # scores the practice site
npm run site           # open site/index.html</code></pre>
  <p class="prose">To test your own cancel page, pass its URL:</p>
  <pre><code>npm start -- https://your-site.com/account</code></pre>
  <p class="prose">If the page needs a login, save a Solari login profile first. The <a href="https://github.com/IamDejman/hotel-california#readme">README</a> shows how.</p>
</section>
<section>
  <h2>How it works</h2>
  <ol class="steps">
    <li><strong>Solari sandbox:</strong> Hosts the practice site. Streamly+ is a fake streaming service. It uses the same cancellation traps as real companies.</li>
    <li><strong>Solari browser:</strong> Does the clicking. It runs in stealth mode and records the whole session. For a real service, it can use a saved login and a proxy in another country.</li>
    <li><strong>AI model:</strong> Decides each step. It reads the page and picks the next click. It records every dark pattern and quotes the exact wording.</li>
    <li><strong>Score:</strong> Starts at 100. Each dark pattern costs points. Extra clicks and extra time cost points too.</li>
    <li><strong>Replay:</strong> The Solari recording becomes the replay. Each charge is marked at the moment it happened.</li>
  </ol>
</section>
<section>
  <h2>Results</h2>
  ${rows ? `<ol class="register">${rows}</ol>` : `<p class="prose">No runs yet.</p>`}
</section>`
  return shell({
    title: "Hotel California: the Cancellation Difficulty Index",
    description: "We send an AI agent to cancel a subscription and score how hard the company makes it to leave. Every run has a replay.",
    path: "",
    body,
  })
}

function runPage(r: RunResult, hasReplay: boolean): string {
  const bill = charges(r.metrics, r.patterns)
  const total = bill.reduce((sum, c) => sum + c.points, 0)
  const rows = bill
    .map((c) => {
      const p = c.pattern === undefined ? undefined : r.patterns[c.pattern]
      const watch = p && hasReplay
        ? `<button type="button" data-mark="${c.pattern}" aria-label="Watch: ${esc(c.label)}" hidden>Watch</button>`
        : ""
      return `<tr>
  <td><div class="charge">${esc(c.label)}</div>${p ? `<p class="quote">“${prose(quoteOf(p.evidence))}”</p>` : ""}${watch}</td>
  <td class="pts">&minus;${c.points}</td>
</tr>`
    })
    .join("\n")

  const player = hasReplay
    ? `<section class="player-shell" aria-label="Session replay">
  <div id="player"></div>
</section>
<script type="application/json" id="run-data">${JSON.stringify({
        replay: `../replays/${slugOf(r)}.ndjson`,
        marks: r.patterns.map((p) => ({ atMs: p.atMs, label: PATTERN_LABELS[p.type] })),
      }).replace(/</g, "\\u003c")}</script>
<script src="${RRWEB_JS}"></script>
<script>${PLAYER_SCRIPT}</script>`
    : `<p class="player-note">No replay was saved for this run.</p>`

  const body = `<header class="site">
  <a class="back" href="../index.html">All checkouts</a>
  <h1 class="run">${esc(nameOf(r))}${esc(regionSuffix(r))}</h1>
  <dl class="facts">
    <div class="score"><dt>Escape Score</dt><dd class="num grade-${r.grade}">${r.score} <span class="grade">${r.grade}</span></dd></div>
    <div><dt>Outcome</dt><dd>${OUTCOME_LABELS[r.outcome]}</dd></div>
    <div><dt>Clicks</dt><dd class="num">${r.metrics.clicks}</dd></div>
    <div><dt>Time</dt><dd class="num">${seconds(r)}s</dd></div>
  </dl>
</header>
${player}
<h2>Checkout bill</h2>
<table class="bill">
  <thead><tr><th scope="col">Charge</th><th scope="col" class="pts">Points</th></tr></thead>
  <tbody>
${rows || `<tr><td>No charges. A clean exit.</td><td class="pts">0</td></tr>`}
  </tbody>
  <tfoot>
    <tr><td>Starting balance</td><td class="pts">100</td></tr>
    <tr><td>Total charges</td><td class="pts">&minus;${total}</td></tr>
    <tr><td>Escape Score</td><td class="pts grade-${r.grade}">${r.score}</td></tr>
  </tfoot>
</table>
<details class="report">
  <summary>Agent’s report</summary>
  <p>${prose(r.summary)}</p>
  <p class="session">${dateOf(r.ranAt)}, Solari session <code title="${esc(r.sessionId)}">${esc(r.sessionId.slice(0, 16))}…</code></p>
</details>`

  return shell({
    title: `${nameOf(r)}${regionSuffix(r)}: Escape Score ${r.score} (${r.grade})`,
    description: `${r.patterns.length} dark patterns logged on the way out. Watch the replay and read the itemized bill.`,
    path: `runs/${slugOf(r)}.html`,
    body,
    extraHead: `<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>
<link rel="stylesheet" href="${RRWEB_CSS}">`,
  })
}

export async function buildSite(): Promise<void> {
  const results = await loadResults()
  await mkdir("site/runs", { recursive: true })
  await mkdir("site/replays", { recursive: true })

  for (const r of results) {
    const slug = slugOf(r)
    let hasReplay = false
    if (r.replayFile) {
      try {
        await access(r.replayFile)
        await copyFile(r.replayFile, path.join("site/replays", `${slug}.ndjson`))
        hasReplay = true
      } catch {
        // replay listed in the result but not on disk; the page says so
      }
    }
    await writeFile(path.join("site/runs", `${slug}.html`), runPage(r, hasReplay))
  }
  await writeFile("site/index.html", indexPage(results))
  console.log(`site: ${results.length} run page(s) in site/ (open site/index.html)`)
}

const entry = process.argv[1] ?? ""
if (entry.endsWith("site.ts") || entry.endsWith("site.js")) {
  await buildSite()
}
