import fs from "node:fs";
import { buildSite } from "./build.mjs";
import { runDiscovery } from "./discover.mjs";
import { platformCtx } from "../lib/platform.mjs";
import { validateArticle } from "../lib/llm.mjs";
import { nowIso } from "../lib/state.mjs";

/**
 * dryrun.mjs — exercises a platform's whole pipeline without API keys:
 *   PLATFORM=finflow npm run run:dry
 * discover (real network, non-fatal) → select → generate (fixture) → build → report.
 */

const ctx = platformCtx();
const config = ctx.config;

let discoveryInfo = "skipped";
try {
  const n = await runDiscovery();
  discoveryInfo = `ok (${n} candidates)`;
} catch (err) {
  console.warn(`[dryrun/${ctx.id}] discover failed (non-fatal): ${err.message}`);
}

if (!fs.existsSync(`${ctx.stateDir}/.discover.json`)) {
  fs.mkdirSync(ctx.stateDir, { recursive: true });
  fs.writeFileSync(
    `${ctx.stateDir}/.discover.json`,
    JSON.stringify(
      { fetchedAt: nowIso(), candidates: [{ source: "fixture", topic: `Best free ${config.niche} tools worth your time in 2026`, score: 5, meta: {} }] },
      null,
      2
    )
  );
  discoveryInfo = "fixture-topic";
}
await import("./select.mjs");

const fixture = JSON.parse(fs.readFileSync("scripts/fixtures/article-fixture.json", "utf8"));
const sel = JSON.parse(fs.readFileSync(`${ctx.stateDir}/.select.json`, "utf8"));
const article = validateArticle(fixture, config.limits);
article._provider = "fixture";
article._topic = sel.topic;
article._slug = sel.slug;
article._angle = sel.angle;
article._source = sel.source;
article._date = nowIso();
fs.writeFileSync(`${ctx.stateDir}/.generate.json`, JSON.stringify(article, null, 2));

const entry = await buildSite(config, article, ctx);
fs.writeFileSync(`${ctx.stateDir}/.built.json`, JSON.stringify(entry, null, 2));
await import("./report.mjs");

console.log(`\n[dryrun/${ctx.id}] DONE — discovery: ${discoveryInfo} · site in ${ctx.distDir}/`);
