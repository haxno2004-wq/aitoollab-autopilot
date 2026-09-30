import fs from "node:fs";
import { nowIso, loadState, saveState } from "../lib/state.mjs";
import { platformCtx, csvEscape } from "../lib/platform.mjs";

const ctx = platformCtx();
const config = ctx.config;
const ghSummary = process.env.GITHUB_STEP_SUMMARY;

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

const built = readJson(`${ctx.stateDir}/.built.json`, null);
const failed = readJson(`${ctx.stateDir}/.failed.txt`, null);

const state = loadState(ctx.stateFile);
state.lastRun = nowIso();

fs.mkdirSync(ctx.stateDir, { recursive: true });

if (built) {
  if (!state.publishedSlugs.includes(built.slug)) state.publishedSlugs.push(built.slug);
  const sel = readJson(`${ctx.stateDir}/.select.json`, null);
  if (sel && !state.usedTopics.some((t) => t.toLowerCase() === sel.topic.toLowerCase())) {
    state.usedTopics.push(sel.topic);
  }
  const row = [nowIso(), built.slug, built.title, built.provider || "gumroad", built.words || "-", "success"];
  fs.appendFileSync(
    ctx.logFile,
    [row[0], csvEscape(row[1]), csvEscape(row[2]), row[3], row[4], row[5]].join(",") + "\n"
  );
  if (ghSummary) {
    fs.appendFileSync(
      ghSummary,
      [
        `## 🤖 [${ctx.id}] run report`,
        "",
        `**Published:** ${built.title}`,
        `- slug: \`${built.slug}\`${built.words ? ` (${built.words} words via ${built.provider})` : ""}`,
        `- total items: ${state.publishedSlugs.length}`,
        "",
      ].join("\n")
    );
  }
  console.log(`[report/${ctx.id}] success: ${built.slug}`);
} else {
  fs.appendFileSync(ctx.logFile, [nowIso(), "-", csvEscape(failed || "no artifacts"), "-", "0", "skipped"].join(",") + "\n");
  if (ghSummary) {
    fs.appendFileSync(ghSummary, [`## 🤖 [${ctx.id}] run report`, "", `**No publish.** Reason: ${failed || "unknown"}`, ""].join("\n"));
  }
  console.log(`[report/${ctx.id}] skipped: ${failed || "no artifacts"}`);
}

saveState(ctx.stateFile, state);
