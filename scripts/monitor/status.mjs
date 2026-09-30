import fs from "node:fs";

/**
 * status.mjs — earnings & health monitor.
 *   npm run status              → terminal report
 *   npm run status -- --summary → Markdown (GitHub Step Summary) format
 *
 * Shows what the bot produced (ground truth from state/ + content/) and whether
 * monetization is switched on. Actual revenue lands in YOUR affiliate/AdSense
 * dashboards — see docs/EARNINGS.md for where to look and realistic timelines.
 */

const summaryMode = process.argv.includes("--summary");
const config = JSON.parse(fs.readFileSync("config.json", "utf8"));

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}
function readLines(file) {
  try {
    return fs.readFileSync(file, "utf8").trim().split("\n").slice(1).filter(Boolean);
  } catch {
    return [];
  }
}

const state = readJson(config.report.stateFile, { publishedSlugs: [], usedTopics: [], lastRun: null });
const rows = readLines(config.report.logFile).map((l) => l.split(","));
const successRows = rows.filter((r) => r[5] === "success");
const skippedRows = rows.filter((r) => r[5] !== "success");

const words = successRows.reduce((sum, r) => sum + (parseInt(r[4], 10) || 0), 0);
const posts = fs.existsSync("content/posts") ? fs.readdirSync("content/posts").filter((f) => f.endsWith(".json")).length : 0;

// daily publishing rate over the last 7 days
const weekAgo = Date.now() - 7 * 864e5;
const last7 = successRows.filter((r) => new Date(r[0]).getTime() > weekAgo).length;

const providers = {};
for (const r of successRows) providers[r[3]] = (providers[r[3]] || 0) + 1;

const monetization = {
  affiliate: config.affiliate.links.some((l) => !l.url.includes("YOUR_ID")),
  adsense: !!(config.adsense?.enabled && config.adsense.client),
  indexnow: !!(config.indexnow?.enabled && config.indexnow.key),
};

const utc = (d) => new Date(d).toISOString().replace("T", " ").slice(0, 16) + " UTC";

function fmtMonetization(md) {
  const line = (on, label, how) =>
    md ? `- ${on ? "✅" : "⬜"} **${label}** — ${on ? "live" : how}` : `  ${on ? "[x]" : "[ ]"} ${label}${on ? "" : " — " + how}`;
  return [
    line(monetization.affiliate, "Affiliate links", "paste referral IDs in config.json → affiliate.links"),
    line(monetization.adsense, "AdSense", "set adsense.enabled + client id after approval"),
    line(monetization.indexnow, "IndexNow (Bing instant indexing)", "generate a UUID key → config.json + secret"),
  ].join("\n");
}

if (summaryMode) {
  const out = [
    "## 📊 Earning monitor",
    "",
    `| Metric | Value |`,
    `|---|---|`,
    `| Articles published | ${state.publishedSlugs.length} (files: ${posts}) |`,
    `| Runs succeeded / skipped | ${successRows.length} / ${skippedRows.length} |`,
    `| Published last 7 days | ${last7} |`,
    `| Total words written | ${words.toLocaleString()} |`,
    `| Providers used | ${Object.entries(providers).map(([k, v]) => `${k}: ${v}`).join(", ") || "—"} |`,
    `| Last run | ${state.lastRun ? utc(state.lastRun) : "never"} |`,
    "",
    "### Monetization switches",
    "",
    fmtMonetization(true),
    "",
    "_Revenue itself appears in your affiliate/AdSense dashboards — see docs/EARNINGS.md._",
    "",
  ];
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, out.join("\n"));
  console.log(out.join("\n"));
} else {
  const bar = (n, max = 30) => "█".repeat(Math.min(n, max)) + (n > max ? "…" : "");
  console.log(
    [
      "",
      "  ⚡ AI ToolLab — Earning Monitor",
      "  ─────────────────────────────────────────────",
      `  Articles published      ${bar(state.publishedSlugs.length)} ${state.publishedSlugs.length}`,
      `  Runs succeeded/skipped  ${successRows.length} / ${skippedRows.length}`,
      `  Published last 7 days   ${bar(last7)} ${last7}`,
      `  Total words written     ${words.toLocaleString()}`,
      `  Providers used          ${Object.entries(providers).map(([k, v]) => `${k}×${v}`).join(", ") || "—"}`,
      `  Last run                ${state.lastRun ? utc(state.lastRun) : "never"}`,
      "",
      "  Monetization switches:",
      fmtMonetization(false),
      "",
      "  Revenue lands in YOUR dashboards (affiliate networks, AdSense).",
      "  See docs/EARNINGS.md for where to look and realistic timelines.",
      "",
    ].join("\n")
  );
}
