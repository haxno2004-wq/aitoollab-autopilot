import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { platformCtx } from "../lib/platform.mjs";
import { fetchWithRetry } from "../lib/http.mjs";

/**
 * discover.mjs — topic discovery from free, keyless sources.
 * Sources are configurable per platform via config.discovery:
 *   { "hn": { "query": "AI OR LLM" }, "github": { "q": "ai stars:>50" }, "reddit": ["personalfinance"] }
 * Defaults keep the original AI-tools behavior.
 */

const ctx = platformCtx();
const config = ctx.config;

// optional per-platform topic filter (regex string in config.discovery.topicFilter)
const TOPIC_RE = config.discovery?.topicFilter ? new RegExp(config.discovery.topicFilter, "i") : null;
const GENERIC = /^(show|hny|ask|tell|poll)[hn]?:/i;
const ASCII_OK = /^[-\x20-~]{10,}$/;

function score(title) {
  let s = 0;
  const t = title.toLowerCase();
  const kws = config.keywords || [];
  if (kws.some((k) => t.includes(k))) s += 3;
  if (/\b(best|top|alternatives|vs|review|comparison|worth it|guide|how to|tools?|stack|workflow|automat|strateg|mistakes|budget|invest|save)/.test(t)) s += 3;
  if (/\b(free|open.?source|self.?host|beginner|simple)/.test(t)) s += 2;
  if (t.length >= 45 && t.length <= 95) s += 1;
  return s;
}

function baseFilter(title) {
  return !GENERIC.test(title) && ASCII_OK.test(title);
}

async function hnSearch(query, sort) {
  const { status, data } = await fetchWithRetry(
    `https://hn.algolia.com/api/v1/${sort}?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=50&numericFilters=points%3E15`,
    { method: "GET" },
    { attempts: 2, baseMs: 1500, timeoutMs: 20000 }
  );
  if (status !== 200 || !data?.hits) throw new Error(`HN HTTP ${status}`);
  return data.hits.map((h) => ({
    source: "hn",
    topic: (h.title || "").replace(/\s*\(\d{4}\)\s*$/, "").trim(),
    score: score(h.title || "") + Math.min(3, Math.floor((h.points || 0) / 100)),
    meta: { points: h.points, url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}` },
  }));
}

async function fromHackerNews() {
  const q = config.discovery?.hn?.query || "AI OR LLM OR agent";
  let hits;
  try {
    hits = await hnSearch(q, "search");
  } catch {
    hits = await hnSearch(q, "search_by_date");
  }
  const out = hits.filter((c) => baseFilter(c.topic) && (!TOPIC_RE || TOPIC_RE.test(c.topic)));
  // Relevance search alone keeps returning the same evergreen hits, which the
  // fleet-wide dedupe exhausts after a few consecutive runs — leaving select
  // with an empty pool ("no unused candidates"). Always top up with the
  // current front page and fresh by-date stories so back-to-back runs still
  // have unused material.
  const topUp = async (url) => {
    try {
      const { status, data } = await fetchWithRetry(url, { method: "GET" }, { attempts: 2, baseMs: 1500, timeoutMs: 20000 });
      if (status !== 200 || !data?.hits) return [];
      return data.hits
        .map((h) => ({
          source: "hn",
          topic: (h.title || "").replace(/\s*\(\d{4}\)\s*$/, "").trim(),
          score: score(h.title || "") + Math.min(3, Math.floor((h.points || 0) / 100)),
          meta: {},
        }))
        .filter((c) => baseFilter(c.topic) && (!TOPIC_RE || TOPIC_RE.test(c.topic)));
    } catch {
      return []; // top-ups are best-effort
    }
  };
  out.push(...(await topUp("https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=50")));
  out.push(...(await topUp(`https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(q)}&tags=story&hitsPerPage=50&numericFilters=points%3E5`)));
  return out;
}

async function fromGithub() {
  const q = config.discovery?.github?.q || "created:>PLACEHOLDER ai stars:>50";
  const date = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const finalQ = q.includes("PLACEHOLDER") ? q.replace("created:>PLACEHOLDER", `created:>${date}`) : q;
  const { status, data } = await fetchWithRetry(
    `https://api.github.com/search/repositories?q=${encodeURIComponent(finalQ)}&sort=stars&order=desc&per_page=25`,
    {
      method: "GET",
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "fleet-autopilot",
        ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
      },
    },
    { attempts: 2, baseMs: 1500, timeoutMs: 20000 }
  );
  if (status !== 200 || !data?.items) throw new Error(`github HTTP ${status}`);
  const out = [];
  for (const r of data.items) {
    const desc = r.description || "";
    if (!desc || desc.length < 20) continue;
    const printable = desc.replace(/[^\x20-~]/g, "").length;
    if (printable / desc.length < 0.7) continue;
    const topic = `${r.name}: ${desc}`.replace(/[^\x20-~\n]/g, "").trim().slice(0, 140);
    out.push({
      source: "github",
      topic,
      score: score(topic) + Math.min(3, Math.floor((r.stargazers_count || 0) / 500)),
      meta: { stars: r.stargazers_count, url: r.html_url },
    });
  }
  return out;
}

async function fromReddit() {
  const subs = config.discovery?.reddit || [];
  const out = [];
  for (const sub of subs) {
    try {
      const { status, data } = await fetchWithRetry(
        `https://www.reddit.com/r/${sub}/top/.rss?t=week&limit=40`,
        { method: "GET", headers: { "user-agent": "fleet-autopilot/1.0" } },
        { attempts: 2, baseMs: 1500, timeoutMs: 20000, rawText: true }
      );
      if (status !== 200 || typeof data !== "string") throw new Error(`reddit HTTP ${status}`);
      // minimal RSS title extraction
      const titles = [...data.matchAll(/<media:title>([^<]+)<\/media:title>|<title>([^<]+)<\/title>/g)]
        .map((m) => (m[1] || m[2] || "").replace(/&#38;/g, "&").replace(/&amp;/g, "&").trim())
        .filter((t) => t && !/^(r\/|reddit)/i.test(t));
      for (const t of titles) {
        if (!baseFilter(t)) continue;
        out.push({ source: `reddit/${sub}`, topic: t, score: score(t), meta: {} });
      }
    } catch (err) {
      console.error(`[discover] r/${sub} failed: ${err.message}`);
    }
  }
  return out;
}

export async function runDiscovery() {
  const sources = [];
  const d = config.discovery || {};
  if (d.hn !== false) sources.push(fromHackerNews());
  if (d.github) sources.push(fromGithub());
  if (d.reddit?.length) sources.push(fromReddit());

  const results = await Promise.allSettled(sources);
  const all = [];
  const errors = [];
  for (const r of results) {
    if (r.status === "fulfilled") all.push(...r.value);
    else errors.push(r.reason?.message || String(r.reason) || "(source failed with no error message)");
  }
  if (!all.length) throw new Error("all discovery sources failed: " + errors.join(" | "));
  if (errors.length) console.error(`[discover/${ctx.id}] partial failures:`, errors.join(" | "));

  const seen = new Map();
  for (const c of all) {
    const key = c.topic.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 60);
    if (!seen.has(key) || seen.get(key).score < c.score) seen.set(key, c);
  }
  const candidates = [...seen.values()].sort((a, b) => b.score - a.score);

  fs.mkdirSync(ctx.stateDir, { recursive: true });
  fs.writeFileSync(`${ctx.stateDir}/.discover.json`, JSON.stringify({ fetchedAt: new Date().toISOString(), candidates }, null, 2));
  console.log(`[discover/${ctx.id}] ${candidates.length} candidates (${all.length} raw)`);
  for (const c of candidates.slice(0, 5)) console.log(`  ${c.score}  [${c.source}] ${c.topic}`);
  return candidates.length;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  runDiscovery().catch((err) => {
    console.error(`[discover/${ctx.id}] FAILED:`, err.message);
    process.exit(1);
  });
}
