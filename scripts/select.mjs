import fs from "node:fs";
import { loadState } from "../lib/state.mjs";
import { slugify } from "../lib/state.mjs";

function angleFor(topic) {
  const t = topic.toLowerCase();
  if (/vs\b|\bversus\b/.test(t)) return "a practical head-to-head comparison with a clear decision framework";
  if (/alternatives?\b/.test(t) || /\bfree\b/.test(t)) return "a curated alternatives/shortlist guide with honest trade-offs";
  if (/open.?source|self.?host/.test(t)) return "a pragmatic setup-and-use guide focused on what it's genuinely good at, plus who should skip it";
  if (/guide|how to|workflow|automat/.test(t)) return "a step-by-step workflow tutorial with concrete setup advice and common pitfalls";
  /review|benchmark|hands.?on/.test(t);
  return "a hands-on review framing: what it is, where it shines, where it fails, and who should use it";
}

function keywordBoost(topic, keywords) {
  const t = topic.toLowerCase();
  let boost = 0;
  for (const k of keywords) if (t.includes(k)) boost += 2;
  return boost;
}

function shortHash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

function main() {
  const config = JSON.parse(fs.readFileSync("config.json", "utf8"));
  const state = loadState(config.report.stateFile);
  const disc = JSON.parse(fs.readFileSync("scripts/.discover.json", "utf8"));

  const used = new Set(state.usedTopics.map((t) => t.toLowerCase()));
  const pool = disc.candidates.filter((c) => !used.has(c.topic.toLowerCase()));

  if (!pool.length) throw new Error("no unused candidates — re-run discover");

  // Sort by score desc, then keyword boost, then stable alpha for determinism.
  const ranked = [...pool]
    .map((c) => ({ ...c, finalScore: c.score + keywordBoost(c.topic, config.keywords) }))
    .sort((a, b) => b.finalScore - a.finalScore || a.topic.localeCompare(b.topic));

  const pick = ranked[0];
  const angle = angleFor(pick.topic);
  let slug = slugify(pick.topic);
  if (slug.length < 8) slug = `${slug || "post"}-${shortHash(pick.topic)}`; // guarantee non-empty, unique file name
  slug = slug.slice(0, 80).replace(/-+$/, "");

  const out = {
    pickedAt: new Date().toISOString(),
    topic: pick.topic,
    angle,
    slug,
    source: pick.source,
    sourceMeta: pick.meta,
    finalScore: pick.finalScore,
    remaining: ranked.length - 1,
  };
  fs.writeFileSync("scripts/.select.json", JSON.stringify(out, null, 2));
  console.log(`[select] picked: "${pick.topic}" (score ${pick.finalScore}, ${pick.source}) → slug ${slug}`);
  if (!out.remaining) console.log("[select] warning: pool exhausted after this pick");
}

main();
