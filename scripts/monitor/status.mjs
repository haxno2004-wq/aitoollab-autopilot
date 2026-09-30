import fs from "node:fs";
import { allPlatforms } from "../../lib/platform.mjs";

/**
 * status.mjs — FLEET earning monitor.
 *   npm run status              → every platform
 *   PLATFORM=finflow npm run status → one platform
 */

const only = process.env.PLATFORM;
const fleet = allPlatforms().filter((p) => !only || p.id === only);
const summaryMode = process.argv.includes("--summary");

function readLines(file) {
  try {
    return fs
      .readFileSync(file, "utf8")
      .replace(/\r/g, "")
      .trim()
      .split("\n")
      .slice(1)
      .filter(Boolean);
  } catch {
    return [];
  }
}

const rows = [];
for (const p of fleet) {
  let state = { publishedSlugs: [], lastRun: null };
  try {
    state = JSON.parse(fs.readFileSync(p.stateFile, "utf8").replace(/\r/g, "") || "{}");
  } catch {
    /* platform has never run yet */
  }
  const log = readLines(p.logFile).map((l) => l.split(","));
  const success = log.filter((r) => r[5] === "success");
  const skipped = log.filter((r) => r[5] !== "success");
  const weekAgo = Date.now() - 7 * 864e5;
  const last7 = success.filter((r) => new Date(r[0]).getTime() > weekAgo).length;
  const words = success.reduce((s, r) => s + (parseInt(r[4], 10) || 0), 0);
  const live = p.type === "store" ? fs.readdirSync(p.productsDir).filter((f) => f.endsWith(".json")).length : fs.readdirSync(p.contentDir).filter((f) => f.endsWith(".json")).length;
  const monetized =
    p.id === "labstore"
      ? !!(p.config.gumroad?.enabled && process.env.GUMROAD_ACCESS_TOKEN)
      : p.config.affiliate?.links?.some((l) => !l.url.includes("YOUR_ID")) || p.config.adsense?.enabled;

  rows.push({
    id: p.id,
    type: p.type,
    url: p.config.site.url,
    items: Math.max(live, state.publishedSlugs?.length || 0),
    words,
    ok: success.length,
    skip: skipped.length,
    last7,
    lastRun: state.lastRun,
    monetized: !!monetized,
  });
}

if (summaryMode) {
  const out = [
    "## 🛰️ Fleet status",
    "",
    "| Platform | Type | Items | Words | OK/Skip | 7d | Monetized |",
    "|---|---|---|---|---|---|---|",
    ...rows.map(
      (r) => `| [${r.id}](${r.url}) | ${r.type} | ${r.items} | ${r.words.toLocaleString()} | ${r.ok}/${r.skip} | ${r.last7} | ${r.monetized ? "✅" : "⬜"} |`
    ),
    "",
  ];
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, out.join("\n"));
  console.log(out.join("\n"));
} else {
  const line = "─".repeat(58);
  console.log(
    [
      "",
      "  🛰️  FLEET COMMAND — earning monitor",
      `  ${line}`,
      ...rows.flatMap((r) => [
        `  ${r.id}  (${r.type})`,
        `    items ${r.items} · words ${r.words.toLocaleString()} · ok/skip ${r.ok}/${r.skip} · 7d ${r.last7} · monetized ${r.monetized ? "YES" : "no"}`,
        `    ${r.url}`,
      ]),
      `  ${line}`,
      "",
    ].join("\n")
  );
}
