import fs from "node:fs";
import { platformCtx } from "../lib/platform.mjs";
import { generateArticle } from "../lib/llm.mjs";
import { nowIso } from "../lib/state.mjs";

const ctx = platformCtx();

const config = ctx.config;

try {
  const sel = JSON.parse(fs.readFileSync(`${ctx.stateDir}/.select.json`, "utf8"));
  const log = (event, detail) => console.log(`[generate/${ctx.id}] ${event}: ${detail}`);
  const article = await generateArticle(config, sel, log);
  fs.writeFileSync(`${ctx.stateDir}/.generate.json`, JSON.stringify({ ...article, _topic: sel.topic, _slug: sel.slug, _angle: sel.angle, _source: sel.source, _sourceMeta: sel.sourceMeta, _date: nowIso() }, null, 2));
  console.log(`[generate/${ctx.id}] OK "${article.title}" — ${article._wordCount} words via ${article._provider}`);
} catch (err) {
  console.error(`[generate/${ctx.id}] FAILED:`, err.message);
  process.exit(1);
}
