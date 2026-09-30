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
const FONTS = "https://fonts.googleapis.com/css2?family=Limelight&display=swap"
const SITE_URL = process.env.SITE_URL?.replace(/\/$/, "")

const CSS = `
* { margin: 0; box-sizing: border-box; }
:root {
  color-scheme: dark;
  --lobby: #2b1216; --panel: #371a1f; --line: #57303a; --ivory: #f3eadb;
  --muted: #c3aa9f; --brass: #d4ad62; --good: #a6dcae; --mid: #eccb74; --bad: #ff9a86;
  --marquee: "Limelight", Georgia, serif;
}
body { background: var(--lobby); color: var(--ivory); font: 16px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; }
a { color: var(--brass); text-underline-offset: 3px; }
a:hover { color: var(--ivory); }
:focus-visible { outline: 2px solid var(--brass); outline-offset: 3px; border-radius: 4px; }
.wrap { max-width: 760px; margin: 0 auto; padding: 0 16px; }
header.site { padding: 56px 0 28px; }
.marquee { font-family: var(--marquee); font-weight: 400; font-size: clamp(40px, 9vw, 64px); line-height: 1.05; color: var(--brass); text-wrap: balance; }
header.site p { color: var(--muted); max-width: 60ch; margin-top: 12px; text-wrap: pretty; }
.back { display: inline-block; margin-bottom: 20px; font-size: 14px; }
h1.run { font-size: 30px; line-height: 1.2; text-wrap: balance; overflow-wrap: anywhere; }
h2 { font-size: 20px; margin: 36px 0 12px; }
.num { font-variant-numeric: tabular-nums; }

.register { list-style: none; padding: 0; border-top: 1px solid var(--line); }
.register a { display: grid; grid-template-columns: 96px 1fr; gap: 20px; padding: 22px 8px; border-bottom: 1px solid var(--line); color: var(--ivory); text-decoration: none; }
.register a:hover { background: var(--panel); }
.register .score { font-family: var(--marquee); font-size: 48px; line-height: 1; }
.register .grade { font-size: 14px; color: var(--muted); margin-top: 6px; }
.register h2 { font-size: 19px; margin: 0; overflow-wrap: anywhere; }
.register p { color: var(--muted); font-size: 14px; margin-top: 4px; }
.grade-A, .grade-B { color: var(--good); }
.grade-C, .grade-D { color: var(--mid); }
.grade-F { color: var(--bad); }

.facts { display: flex; flex-wrap: wrap; gap: 12px 32px; margin: 20px 0 8px; }
.facts dt { font-size: 13px; color: var(--muted); }
.facts dd { font-size: 22px; font-weight: 700; }
.facts .score dd { font-family: var(--marquee); font-weight: 400; font-size: 34px; line-height: 1.1; }

.player-shell { margin: 28px 0 8px; }
#player { min-height: 120px; }
#player .rr-player { max-width: 100%; background: var(--panel); box-shadow: none; }
#player .rr-controller { background: var(--panel); color: var(--ivory); }
#player .rr-timeline__time { color: var(--muted); }
.player-note { color: var(--muted); font-size: 14px; margin-top: 10px; }
.rr-progress { position: relative; }
.marker { position: absolute; top: -9px; width: 20px; height: 24px; margin-left: -10px; padding: 0; border: 0; background: none; cursor: pointer; z-index: 5; touch-action: manipulation; }
.marker::before { content: ""; position: absolute; left: 6px; top: 5px; width: 8px; height: 14px; border-radius: 2px; background: var(--bad); }
.marker:hover::before { background: var(--ivory); }

.bill { width: 100%; border-collapse: collapse; }
.bill th { text-align: left; font-size: 13px; font-weight: 600; color: var(--muted); padding: 8px 0; border-bottom: 1px solid var(--line); }
.bill td { padding: 14px 0; border-bottom: 1px dashed var(--line); vertical-align: top; }
.bill .pts { text-align: right; white-space: nowrap; padding-left: 16px; font-variant-numeric: tabular-nums; }
.bill .charge { font-weight: 600; }
.bill .quote { color: var(--muted); font-size: 14px; margin-top: 4px; overflow-wrap: anywhere; }
.bill button { margin-top: 8px; background: none; border: 1px solid var(--line); color: var(--brass); border-radius: 999px; padding: 4px 12px; font: inherit; font-size: 13px; cursor: pointer; touch-action: manipulation; }
.bill button:hover { border-color: var(--brass); }
.bill tfoot td { border-bottom: 0; padding-top: 10px; }
.bill tfoot tr:last-child td { border-top: 2px solid var(--ivory); padding-top: 14px; font-size: 20px; font-weight: 700; }
.report { margin-top: 32px; color: var(--muted); }
.report summary { cursor: pointer; color: var(--ivory); font-weight: 600; }
.report p { margin-top: 10px; max-width: 65ch; }
.session { font-size: 13px; overflow-wrap: anywhere; }
footer.site { color: var(--muted); font-size: 13px; padding-block: 48px; }
@media (max-width: 520px) { .register a { grid-template-columns: 72px 1fr; gap: 14px; } .register .score { font-size: 38px; } }
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
<meta name="theme-color" content="#2b1216">
<title>${esc(page.title)}</title>
<meta name="description" content="${esc(page.description)}">
<meta property="og:title" content="${esc(page.title)}">
<meta property="og:description" content="${esc(page.description)}">
<meta property="og:type" content="website">
${preview}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}">
<style>${CSS}</style>
${page.extraHead ?? ""}
</head>
<body>
<main class="wrap">
${page.body}
</main>
<footer class="site wrap">Built on <a href="https://getsolari.com">Solari</a> and Claude. <a href="https://github.com/IamDejman/hotel-california">Source</a></footer>
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
    <h2>${esc(nameOf(r))}${esc(regionSuffix(r))}</h2>
    <p>${OUTCOME_LABELS[r.outcome]}. ${r.patterns.length} dark patterns in ${seconds(r)}s.</p>
  </div>
</a></li>`
    })
    .join("\n")
  const body = `<header class="site">
  <h1 class="marquee">Hotel California</h1>
  <p>An AI agent tries to cancel. Every dark pattern goes on the bill.</p>
</header>
${rows ? `<ol class="register">${rows}</ol>` : `<p>No runs yet. Run <code>npm start -- gym</code> to score the practice gym, then <code>npm run site</code>.</p>`}`
  return shell({
    title: "Hotel California: the Cancellation Difficulty Index",
    description: "An AI agent cancels subscriptions, bills companies for every dark pattern on the way out, and keeps the replay as the receipt.",
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
