import fs from "node:fs";
import { nowIso, loadState, saveState } from "../lib/state.mjs";

const config = JSON.parse(fs.readFileSync("config.json", "utf8"));
const stateFile = config.report.stateFile;
const logFile = config.report.logFile;

const ghSummary = process.env.GITHUB_STEP_SUMMARY;

function csvEscape(s) {
  s = String(s ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function appendCsv(file, row) {
  fs.mkdirSync("state", { recursive: true });
  fs.appendFileSync(file, row + "\n");
}

function readFileJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function readFileText(file, fallback) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return fallback;
  }
}

// ---- gather stage artifacts ----
const built = readFileJson("scripts/.built.json", null);
const failed = readFileText("scripts/.failed.txt", null);
const discover = readFileJson("scripts/.discover.json", null);

const state = loadState(stateFile);
state.lastRun = nowIso();

let row;
if (built) {
  if (!state.publishedSlugs.includes(built.slug)) state.publishedSlugs.push(built.slug);
  const sel = readFileJson("scripts/.select.json", null);
  if (sel && !state.usedTopics.some((t) => t.toLowerCase() === sel.topic.toLowerCase())) {
    state.usedTopics.push(sel.topic);
  }
  row = [nowIso(), built.slug, built.title, built.provider, built.words, "success"];
  appendCsv(logFile, [row[0], csvEscape(row[1]), csvEscape(row[2]), row[3], row[4], row[5]].join(","));

  if (ghSummary) {
    fs.appendFileSync(
      ghSummary,
      [
        "## Autopilot run report",
        "",
        `**Published:** [${built.title}](${config.site.url.replace(/\/+$/, "")}/posts/${built.slug}.html)`,
        `- slug: \`${built.slug}\` (${built.words} words via ${built.provider})`,
        `- total posts: ${state.publishedSlugs.length}`,
        `- candidates found this run: ${discover?.candidates?.length ?? "?"}`,
        "",
      ].join("\n")
    );
  }
  console.log(`[report] success: ${built.slug}`);
} else {
  row = [nowIso(), "-", failed ? "generation failed quality/skip" : "no run", "-", 0, "skipped"];
  appendCsv(logFile, [row[0], "-", csvEscape(failed || row[2]), "-", "0", "skipped"]);
  if (ghSummary) {
    fs.appendFileSync(
      ghSummary,
      ["## Autopilot run report", "", `**No publish this run.** Reason: ${failed || "unknown"}`, ""].join("\n")
    );
  }
  console.log(`[report] skipped: ${failed || "no artifacts"}`);
}

saveState(stateFile, state);
