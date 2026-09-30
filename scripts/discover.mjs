import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { fetchWithRetry } from "../lib/http.mjs";

/**
 * discover.mjs — pull candidate topics from free, keyless sources:
 *   1. Hacker News (Algolia API): front-page + top story titles about AI/LLM/agents/automation
 *   2. GitHub Trending via github.com/trending HTML scrape (fallback: search API for recently-created AI repos)
 * Output: scripts/.discover.json with a de-duplicated, scored candidate list.
 */

const AI_RE = /\b(ai|a\.i\.|llm|gpt|gemini|claude|copilot|agent|agents|automation|automate|open.?source|model|prompt|rts?|voice|image gen|video gen|rag|mcp|workflow)\b/i;
const AI_REPO_RE = /(ai|llm|gpt|agent|rag|mcp|prompt|automation|copilot|voice|diffus)/i;
const GENERIC = /^(show|hny|ask|tell|poll)[hn]?:/i;

function score(title) {
  let s = 0;
  const t = title.toLowerCase();
  if (/\b(best|top|alternatives|vs|review|comparison|worth it|guide|how to|tools?|stack|workflow|automat)/.test(t)) s += 3;
  if (/\b(free|open.?source|self.?host)/.test(t)) s += 2;
  if (t.length >= 45 && t.length <= 95) s += 1; // article-length sweet spot
  return s;
}

async function fromHackerNews() {
  const cands = [];
  let data;
  const first = await fetchWithRetry(
    "https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=50",
    { method: "GET" },
    { attempts: 2, baseMs: 1500, timeoutMs: 20000 },
  );
  if (first.status !== 200 || !first.data?.hits) {
    console.error(`[discover] HN front page unavailable (HTTP ${first.status}), trying recent search`);
    const alt = await fetchWithRetry(
      "https://hn.algolia.com/api/v1/search_by_date?query=AI%20OR%20LLM%20OR%20agent&tags=story&hitsPerPage=50&numericFilters=points%3E20",
      { method: "GET" },
      { attempts: 2, baseMs: 1500, timeoutMs: 20000 },
    );
    if (alt.status !== 200 || !alt.data?.hits) throw new Error(`HN sources failed (${alt.status})`);
    data = alt.data;
  } else {
    data = first.data;
  }
  for (const h of data.hits) {
    const title = h.title || "";
    if (GENERIC.test(title) || !AI_RE.test(title)) continue;
    if (!/^[-\x20-~]{10,}$/.test(title)) continue; // English-language site: printable ASCII only
    cands.push({
      source: "hn",
      topic: title.replace(/\s*\(\d{4}\)\s*$/, "").trim(),
      score: score(title) + Math.min(3, Math.floor((h.points || 0) / 100)),
      meta: { points: h.points, url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}` },
    });
  }
  return cands;
}

async function fromGithubTrending() {
  const cands = [];
  const { status, data } = await fetchWithRetry(
    "https://api.github.com/search/repositories?q=created:%3E" +
      new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10) +
      "+ai+stars:%3E50&sort=stars&order=desc&per_page=25",
    {
      method: "GET",
      headers: {
        accept: "application/vnd.github+json",
        // GITHUB_TOKEN improves rate limits in Actions; anonymous works locally
        ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
        "user-agent": "ai-tools-content-autopilot",
      },
    },
    { attempts: 2, baseMs: 1500, timeoutMs: 20000 },
  );
  if (status !== 200 || !data?.items) throw new Error(`github search HTTP ${status}`);
  for (const r of data.items) {
    const desc = r.description || "";
    const name = `${r.name} — ${desc}`.trim();
    if (!AI_REPO_RE.test(name)) continue;
    // prefer ASCII-describable projects; skip repos whose description is mostly non-Latin
    const printable = desc.replace(/[^\x20-~]/g, "").length;
    if (desc.length > 20 && printable / desc.length < 0.7) continue;
    const topic = `${r.name}: ${desc || "what it does and why developers care"}`.replace(/[^\x20-~\n]/g, "").trim().slice(0, 140) || `${r.name}: what it does and why developers care`;
    cands.push({
      source: "github",
      topic,
      score: score(name) + Math.min(3, Math.floor((r.stargazers_count || 0) / 500)),
      meta: { stars: r.stargazers_count, url: r.html_url },
    });
  }
  return cands;
}

export async function runDiscovery() {
  const sources = [fromHackerNews(), fromGithubTrending()];
  const results = await Promise.allSettled(sources);
  const all = [];
  const errors = [];
  for (const r of results) {
    if (r.status === "fulfilled") all.push(...r.value);
    else errors.push(r.reason?.message || String(r.reason));
  }
  if (!all.length) throw new Error("all discovery sources failed: " + errors.join(" | "));
  if (errors.length) console.error("[discover] partial failures:", errors.join(" | "));

  // dedupe by normalized title
  const seen = new Map();
  for (const c of all) {
    const key = c.topic.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 60);
    if (!seen.has(key) || seen.get(key).score < c.score) seen.set(key, c);
  }
  const candidates = [...seen.values()].sort((a, b) => b.score - a.score);

  const out = { fetchedAt: new Date().toISOString(), candidates };
  fs.mkdirSync("scripts", { recursive: true });
  fs.writeFileSync("scripts/.discover.json", JSON.stringify(out, null, 2));
  console.log(`[discover] ${candidates.length} candidates (${all.length} raw)`);
  for (const c of candidates.slice(0, 8)) console.log(`  ${c.score}  [${c.source}] ${c.topic}`);
  return candidates.length;
}

// CLI (only when executed directly, not when imported)
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

async function main() {
  try {
    await runDiscovery();
  } catch (err) {
    console.error("[discover] FAILED:", err.message);
    process.exit(1);
  }
}

if (isMain) main();
