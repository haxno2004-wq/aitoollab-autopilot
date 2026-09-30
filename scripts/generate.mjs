import fs from "node:fs";
import { generateArticle } from "../lib/llm.mjs";
import { nowIso } from "../lib/state.mjs";

const config = JSON.parse(fs.readFileSync("config.json", "utf8"));

try {
  const sel = JSON.parse(fs.readFileSync("scripts/.select.json", "utf8"));
  const log = (event, detail) => console.log(`[generate] ${event}: ${detail}`);
  const article = await generateArticle(config, sel, log);
  fs.writeFileSync("scripts/.generate.json", JSON.stringify({ ...article, _topic: sel.topic, _slug: sel.slug, _angle: sel.angle, _source: sel.source, _sourceMeta: sel.sourceMeta, _date: nowIso() }, null, 2));
  console.log(`[generate] OK "${article.title}" — ${article._wordCount} words via ${article._provider}`);
} catch (err) {
  console.error("[generate] FAILED:", err.message);
  process.exit(1);
}
