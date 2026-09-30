import fs from "node:fs";
import { buildSite } from "./build.mjs";
import { runDiscovery } from "./discover.mjs";
import { validateArticle } from "../lib/llm.mjs";

/**
 * dryrun.mjs — exercises the whole pipeline without API keys:
 *   discover (real network, non-fatal) → select → generate (fixture) → build → report.
 * Output lands in public/ for inspection.
 */

// 1. discovery — real network, but failure is non-fatal here
let discoveryInfo = "skipped";
try {
  const n = await runDiscovery();
  discoveryInfo = `ok (${n} candidates)`;
} catch (err) {
  console.warn(`[dryrun] discover failed (non-fatal): ${err.message}`);
}

// 2. selection — needs discovery output; synthesize a fallback topic if discovery failed
if (!fs.existsSync("scripts/.discover.json")) {
  fs.writeFileSync(
    "scripts/.discover.json",
    JSON.stringify(
      {
        fetchedAt: new Date().toISOString(),
        candidates: [
          {
            source: "fixture",
            topic: "Best free AI tools for automating your workday in 2026",
            score: 5,
            meta: { url: "https://example.com" },
          },
        ],
      },
      null,
      2
    )
  );
  discoveryInfo = "fixture-topic";
}
await import("./select.mjs");

// 3. generation — use fixture instead of calling providers
const fixture = JSON.parse(fs.readFileSync("scripts/fixtures/article-fixture.json", "utf8"));
const sel = JSON.parse(fs.readFileSync("scripts/.select.json", "utf8"));
const config = JSON.parse(fs.readFileSync("config.json", "utf8"));

const article = validateArticle(fixture, config.limits);
article._provider = "fixture";
article._topic = sel.topic;
article._slug = sel.slug;
article._angle = sel.angle;
article._source = sel.source;
article._date = new Date().toISOString();
fs.writeFileSync(
  "scripts/.generate.json",
  JSON.stringify({ ...article, _topic: sel.topic, _slug: sel.slug }, null, 2)
);

// 4. build
const entry = buildSite(config, article);
fs.writeFileSync("scripts/.built.json", JSON.stringify(entry, null, 2));

// 5. report (direct call so .built.json is guaranteed present)
await import("./report.mjs");

console.log(`\n[dryrun] DONE — discovery: ${discoveryInfo} · site in public/ · open public/index.html to inspect`);
