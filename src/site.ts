/**
 * The Replay Theater: builds a static site (site/) from results/*.json where
 * every run is a scorecard with an embedded rrweb replay of the escape, and
 * every dark pattern the agent recorded is a marker pinned to the replay
 * timeline. Publish site/ anywhere static (GitHub Pages works).
 *
 *   npm run site
 */
import { copyFile, mkdir, readFile, readdir, writeFile, access } from "node:fs/promises"
import path from "node:path"
import { PATTERN_LABELS } from "./score.js"
import type { PatternType, RunResult } from "./types.js"

const RRWEB_CSS = "https://cdn.jsdelivr.net/npm/rrweb-player@1.0.0-alpha.4/dist/style.css"
const RRWEB_JS = "https://cdn.jsdelivr.net/npm/rrweb-player@1.0.0-alpha.4/dist/index.js"

const CSS = `
* { margin: 0; box-sizing: border-box; }
:root {
  --bg: #0b0a14; --panel: #14121f; --line: #262336; --text: #ece9f4;
  --muted: #9d97b5; --accent: #e8b44c; --good: #4ade80; --mid: #facc15; --bad: #f87171;
}
body { background: var(--bg); color: var(--text); font-family: -apple-system, "Segoe UI", Roboto, sans-serif; line-height: 1.55; }
a { color: var(--accent); }
.wrap { max-width: 880px; margin: 0 auto; padding: 24px; }
header.site { padding: 56px 0 32px; }
header.site h1 { font-size: 34px; letter-spacing: -0.5px; }
header.site p { color: var(--muted); max-width: 60ch; margin-top: 8px; }
.eyebrow { color: var(--accent); font-size: 12px; text-transform: uppercase; letter-spacing: 2px; font-weight: 700; }
.card { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 22px; margin-bottom: 16px; display: flex; gap: 20px; align-items: center; text-decoration: none; color: var(--text); }
.card:hover { border-color: var(--accent); }
.score { font-size: 40px; font-weight: 800; min-width: 92px; text-align: center; }
.grade-A, .grade-B { color: var(--good); }
.grade-C, .grade-D { color: var(--mid); }
.grade-F { color: var(--bad); }
.card .meta { flex: 1; }
.card h2 { font-size: 19px; }
.card .sub { color: var(--muted); font-size: 13px; margin-top: 2px; }
.chips { margin-top: 10px; display: flex; flex-wrap: wrap; gap: 6px; }
.chip { font-size: 11px; padding: 3px 9px; border-radius: 999px; border: 1px solid var(--line); color: var(--muted); }
.chip.dark { border-color: #7f1d1d; color: #fca5a5; }
.stats { display: flex; gap: 24px; margin: 18px 0 26px; flex-wrap: wrap; }
.stat .n { font-size: 26px; font-weight: 800; }
.stat .l { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 1px; }
.player-shell { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 14px; margin: 20px 0; }
#player { overflow: hidden; border-radius: 10px; }
.rr-player { max-width: 100%; }
.player-note { color: var(--muted); font-size: 13px; margin-top: 10px; }
.evidence { list-style: none; }
.evidence li { border-left: 3px solid var(--accent); padding: 8px 14px; margin-bottom: 10px; background: var(--panel); border-radius: 0 10px 10px 0; }
.evidence .t { font-weight: 700; font-size: 14px; }
.evidence .q { color: var(--muted); font-size: 13px; }
.evidence button { background: none; border: 0; color: var(--accent); cursor: pointer; font-size: 12px; padding: 0; text-decoration: underline; }
.marker { position: absolute; top: -3px; width: 6px; height: 12px; background: var(--bad); border-radius: 2px; cursor: pointer; z-index: 5; }
.rr-progress { position: relative; }
footer.site { color: var(--muted); font-size: 12px; padding: 40px 0; }
@media (max-width: 600px) { .card { flex-direction: column; align-items: flex-start; } .score { text-align: left; } }
`

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

const slugOf = (r: RunResult): string =>
  r.region === "direct" ? r.service : `${r.service}@${r.region}`

function shell(title: string, body: string, extraHead = ""): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${CSS}</style>
${extraHead}
</head>
<body>
<div class="wrap">
${body}
<footer class="site">Hotel California: an AI agent that cancels subscriptions and grades the exit. Runs are against the account owner's own subscriptions; scores reflect what the agent was shown on the stated date. Built on Solari cloud browsers + sandboxes, driven by Claude.</footer>
</div>
</body>
</html>
`
}

function indexPage(results: RunResult[]): string {
  const cards = results
    .map((r) => {
      const patterns = [...new Set(r.patterns.map((p) => p.type))]
      const chips = patterns
        .map((t) => `<span class="chip dark">${esc(PATTERN_LABELS[t as PatternType])}</span>`)
        .join("")
      return `<a class="card" href="runs/${esc(slugOf(r))}.html">
  <div class="score grade-${r.grade}">${r.score}<div style="font-size:13px">grade ${r.grade}</div></div>
  <div class="meta">
    <h2>${esc(r.service)}${r.region !== "direct" ? ` <span class="chip">${esc(r.region.toUpperCase())} egress</span>` : ""}</h2>
    <div class="sub">${esc(r.outcome)} in ${r.metrics.clicks} clicks and ${Math.round(r.metrics.durationMs / 1000)}s on ${esc(r.ranAt.slice(0, 10))}</div>
    <div class="chips">${chips || '<span class="chip">no dark patterns observed</span>'}</div>
  </div>
</a>`
    })
    .join("\n")
  const body = `<header class="site">
  <div class="eyebrow">The Cancellation Difficulty Index</div>
  <h1>Hotel California</h1>
  <p>You can check out any time you like. An AI agent checked whether you can actually leave: it ran each cancellation itself, recorded every dark pattern it was hit with, and kept the session replay as the receipt. Lower score = harder to escape.</p>
</header>
${cards || "<p>No runs yet. <code>npm start -- gym</code> to score the practice gym.</p>"}`
  return shell("Hotel California: Cancellation Difficulty Index", body)
}

function runPage(r: RunResult, hasReplay: boolean): string {
  const slug = slugOf(r)
  const evidence = r.patterns
    .map(
      (p, i) => `<li>
  <div class="t">${esc(PATTERN_LABELS[p.type])}</div>
  <div class="q">"${esc(p.evidence)}"</div>
  ${hasReplay ? `<button data-marker="${i}">jump to this moment in the replay</button>` : ""}
</li>`,
    )
    .join("\n")

  const playerBlock = hasReplay
    ? `<div class="player-shell">
  <div id="player"></div>
  <p class="player-note">DOM-level session replay (rrweb), recorded by the Solari cloud browser. Red ticks on the timeline are the moments the agent recorded a dark pattern.</p>
</div>
<script src="${RRWEB_JS}"></script>
<script>
const PATTERNS = ${JSON.stringify(r.patterns.map((p) => ({ atMs: p.atMs, label: PATTERN_LABELS[p.type] })))};
async function boot() {
  const res = await fetch("../replays/${slug}.ndjson");
  const text = await res.text();
  const events = text.split("\\n").filter(Boolean).map((l) => JSON.parse(l));
  if (events.length === 0) return;
  const start = events[0].timestamp;
  const end = events[events.length - 1].timestamp;
  const player = new rrwebPlayer({
    target: document.getElementById("player"),
    props: { events, autoPlay: false, width: Math.min(820, innerWidth - 80) },
  });
  const offsets = PATTERNS.map((p) => Math.max(0, Math.min(p.atMs - start, end - start)));
  setTimeout(() => {
    const bar = document.querySelector(".rr-progress");
    if (!bar) return;
    offsets.forEach((off, i) => {
      const m = document.createElement("div");
      m.className = "marker";
      m.title = PATTERNS[i].label;
      m.style.left = ((off / (end - start)) * 100) + "%";
      m.addEventListener("click", (e) => { e.stopPropagation(); player.goto(off); });
      bar.appendChild(m);
    });
  }, 500);
  document.querySelectorAll("[data-marker]").forEach((btn) => {
    btn.addEventListener("click", () => {
      player.goto(offsets[Number(btn.dataset.marker)]);
      player.play();
      document.getElementById("player").scrollIntoView({ behavior: "smooth" });
    });
  });
}
boot().catch((err) => { console.error(err); });
</script>`
    : `<div class="player-shell"><p class="player-note">No replay file was available for this run.</p></div>`

  const body = `<header class="site">
  <div class="eyebrow"><a href="../index.html">Cancellation Difficulty Index</a></div>
  <h1>${esc(r.service)}${r.region !== "direct" ? ` (${esc(r.region.toUpperCase())} egress)` : ""}</h1>
  <p>${esc(r.summary)}</p>
</header>
<div class="stats">
  <div class="stat"><div class="n grade-${r.grade}">${r.score}/100</div><div class="l">Escape Score (${r.grade})</div></div>
  <div class="stat"><div class="n">${esc(r.outcome)}</div><div class="l">Outcome</div></div>
  <div class="stat"><div class="n">${r.metrics.clicks}</div><div class="l">Clicks</div></div>
  <div class="stat"><div class="n">${Math.round(r.metrics.durationMs / 1000)}s</div><div class="l">Time</div></div>
  <div class="stat"><div class="n">${r.patterns.length}</div><div class="l">Dark patterns</div></div>
</div>
${playerBlock}
<h2 style="margin: 26px 0 12px">What the agent was hit with</h2>
<ul class="evidence">${evidence || "<li><div class='t'>Nothing. A clean exit.</div></li>"}</ul>
<p class="player-note" style="margin-top:22px">Session <code>${esc(r.sessionId)}</code>, run ${esc(r.ranAt)}.</p>`
  return shell(`${r.service}: Escape Score ${r.score}`, body, `<link rel="stylesheet" href="${RRWEB_CSS}">`)
}

export async function buildSite(): Promise<void> {
  let files: string[] = []
  try {
    files = (await readdir("results")).filter((f) => f.endsWith(".json"))
  } catch {
    // no results yet
  }
  const results: RunResult[] = []
  for (const f of files) {
    results.push(JSON.parse(await readFile(path.join("results", f), "utf8")) as RunResult)
  }
  results.sort((a, b) => a.score - b.score)

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
        // replay listed in the result but not on disk; page degrades gracefully
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
