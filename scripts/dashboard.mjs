import fs from "node:fs";
import { allPlatforms } from "../lib/platform.mjs";

/**
 * dashboard.mjs — builds the Command Deck: one live page monitoring every
 * platform (items, words, runs, 7d rate, monetization switches, links) plus a
 * manually-fed revenue table. Deployed to fleetdeck.pages.dev.
 */

const REPO = process.env.GITHUB_REPOSITORY || "haxno2004-wq/aitoollab-autopilot";
const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;

function readJson(f, fb) {
  try {
    return JSON.parse(fs.readFileSync(f, "utf8"));
  } catch {
    return fb;
  }
}
function readLines(f) {
  try {
    return fs.readFileSync(f, "utf8").replace(/\r/g, "").trim().split("\n").slice(1).filter(Boolean);
  } catch {
    return [];
  }
}

async function ghStats() {
  if (!TOKEN) return { runs: null, note: "no token — live run stats unavailable" };
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/actions/runs?per_page=30`, {
      headers: { authorization: `Bearer ${TOKEN}`, "user-agent": "fleetdeck" },
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json();
    const runs = (data.workflow_runs || []).map((r) => ({
      name: r.name,
      status: r.status,
      conclusion: r.conclusion,
      at: r.created_at,
      url: r.html_url,
    }));
    return { runs, note: null };
  } catch (e) {
    return { runs: null, note: e.message };
  }
}

function fleetRows() {
  return allPlatforms().map((p) => {
    const state = readJson(p.stateFile, { publishedSlugs: [], lastRun: null });
    const log = readLines(p.logFile).map((l) => l.split(","));
    const ok = log.filter((r) => r[5] === "success");
    const skip = log.filter((r) => r[5] !== "success");
    const weekAgo = Date.now() - 7 * 864e5;
    const archiveDir = p.type === "store" ? p.productsDir : p.contentDir;
    const files = fs.existsSync(archiveDir) ? fs.readdirSync(archiveDir).filter((f) => f.endsWith(".json")).length : 0;
    const words = ok.reduce((s, r) => s + (parseInt(r[4], 10) || 0), 0);
    const monetized =
      p.type === "store"
        ? !!(p.config.gumroad?.enabled && process.env.GUMROAD_ACCESS_TOKEN)
        : p.config.affiliate?.links?.some((l) => !l.url.includes("YOUR_ID")) || p.config.adsense?.enabled;
    return {
      id: p.id,
      type: p.type,
      name: p.config.site.name,
      url: p.config.site.url,
      tagline: p.config.site.tagline,
      items: Math.max(files, state.publishedSlugs.length),
      words,
      ok: ok.length,
      skip: skip.length,
      last7: ok.filter((r) => new Date(r[0]).getTime() > weekAgo).length,
      lastRun: state.lastRun,
      monetized,
    };
  });
}

function revenueTable() {
  // You feed this file monthly: state/revenue.csv → month,platform,source,amount
  try {
    return fs
      .readFileSync("state/revenue.csv", "utf8")
      .replace(/\r/g, "")
      .trim()
      .split("\n")
      .slice(1)
      .filter(Boolean)
      .map((l) => l.split(","));
  } catch {
    return [];
  }
}

function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const rows = fleetRows();
const { runs, note } = await ghStats();
const revenue = revenueTable();
const totals = {
  items: rows.reduce((s, r) => s + r.items, 0),
  words: rows.reduce((s, r) => s + r.words, 0),
  ok: rows.reduce((s, r) => s + r.ok, 0),
  rev: revenue.reduce((s, r) => s + (parseFloat(r[3]) || 0), 0),
};
const recentRuns = (runs || []).slice(0, 10);
const usd = (n) => `$${n.toFixed(2)}`;

const html = `<!doctype html>
<html lang="en" class="no-js">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Fleet Command Deck — Autonomous Earning Monitor</title>
<meta name="robots" content="noindex">
<link rel="stylesheet" href="/shared/style.css">
<script>(function(){try{var t=localStorage.getItem('theme');if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.setAttribute('data-theme','dark')}catch(e){}})()</script>
</head>
<body>
<header class="site-head"><div class="wrap head-wrap"><a class="brand" href="/">🛰️ Fleet Command Deck</a><nav><a href="https://github.com/${esc(REPO)}/actions" target="_blank">Actions ↗</a></nav></div></header>
<main class="wrap">
  <section class="hero">
    <span class="eyebrow">live · rebuilt after every fleet run</span>
    <h1>4 platforms. One dashboard.</h1>
    <p class="dek">Autonomous earning fleet status — content volume, run health, monetization switches, revenue.</p>
  </section>

  <section class="kpi-grid">
    <div class="kpi"><span class="kpi-num">${totals.items}</span><span class="kpi-label">items published</span></div>
    <div class="kpi"><span class="kpi-num">${totals.words.toLocaleString()}</span><span class="kpi-label">words written</span></div>
    <div class="kpi"><span class="kpi-num">${totals.ok}</span><span class="kpi-label">successful runs</span></div>
    <div class="kpi"><span class="kpi-num">${usd(totals.rev)}</span><span class="kpi-label">revenue logged</span></div>
  </section>

  <section>
    <h2>Platforms</h2>
    <ul class="posts">
    ${rows
      .map(
        (r) => `<li class="card"><div class="card-body">
      <a href="${esc(r.url)}" target="_blank" rel="noopener"><h2>${esc(r.name)} <span class="tag">↗</span></h2></a>
      <p class="dek">${esc(r.tagline)}</p>
      <p class="meta">type: <span class="tag">${esc(r.type)}</span> · items <strong>${r.items}</strong> · words <strong>${r.words.toLocaleString()}</strong> · runs <strong>${r.ok}/${r.ok + r.skip}</strong> · 7d <strong>${r.last7}</strong> · monetized <strong>${r.monetized ? "✅" : "⬜"}</strong>${r.lastRun ? ` · last run <time>${r.lastRun.slice(0, 16).replace("T", " ")}</time>` : ""}</p>
      </div></li>`
      )
      .join("\n")}
    </ul>
  </section>

  <section>
    <h2>Revenue log</h2>
    ${
      revenue.length
        ? `<table class="rev"><tr><th>month</th><th>platform</th><th>source</th><th>amount</th></tr>${revenue
            .map((r) => `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td><td>${esc(r[2])}</td><td>${usd(parseFloat(r[3]) || 0)}</td></tr>`)
            .join("")}</table>`
        : `<p class="muted-note">No revenue logged yet — that's expected in the first weeks. Revenue appears in your affiliate/Gumroad/AdSense dashboards; add rows to <code>state/revenue.csv</code> (<code>month,platform,source,amount</code>) and redeploy to see them here. See docs/EARNINGS.md for realistic timelines.</p>`
    }
  </section>

  <section>
    <h2>Recent fleet runs</h2>
    ${note ? `<p class="muted-note">Live run feed unavailable: ${esc(note)}</p>` : ""}
    ${
      recentRuns.length
        ? `<table class="rev"><tr><th>when (UTC)</th><th>workflow</th><th>result</th><th></th></tr>${recentRuns
            .map(
              (r) =>
                `<tr><td>${esc(String(r.at).slice(0, 16).replace("T", " "))}</td><td>${esc(r.name)}</td><td>${esc(r.conclusion || r.status)}</td><td><a href="${esc(r.url)}" target="_blank" rel="noopener">open ↗</a></td></tr>`
            )
            .join("")}</table>`
        : ""
    }
  </section>
</main>
<footer class="site-foot"><div class="wrap">🛰️ Fleet Command Deck · rebuilt automatically · <a href="https://github.com/${esc(REPO)}">source</a></div></footer>
<script src="/shared/site.js" defer></script>
</body>
</html>`;

fs.mkdirSync("dist/dashboard", { recursive: true });
fs.cpSync("site/assets", "dist/dashboard/assets", { recursive: true });
fs.cpSync("site/shared", "dist/dashboard/shared", { recursive: true });
fs.writeFileSync("dist/dashboard/index.html", html);
console.log(`[dashboard] built — ${rows.length} platforms, ${totals.items} items, recent runs: ${recentRuns.length}`);
