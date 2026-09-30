import { fetchWithRetry } from "./http.mjs";
import { wordCount } from "./markdown.mjs";

const SYSTEM = `You are the senior editor of a high-quality AI-tools publication. You write accurate, practical, specific articles. You never invent statistics, prices, or fake research. When unsure about a fact, you keep the claim general or clearly hedge it.`;

const USER_TMPL = (topic, angle, keywords, limits) => `Write a complete SEO article as STRICT JSON (no markdown fences, no commentary). Respond with ONLY a JSON object with exactly this shape:

{
  "title": "SEO title, 50-65 chars, compelling, no clickbait",
  "metaDescription": "150-160 chars summary",
  "tags": ["3-6 lowercase topical tags"],
  "sections": [
    { "heading": "section heading", "body": "markdown paragraphs; may include - bullet lists and **bold**. 220-350 words per section." }
  ],
  "faq": [
    { "q": "question", "a": "2-4 sentence answer" }
  ],
  "keyTakeaway": "one-sentence takeaway"
}

Requirements:
- Topic: ${topic}
- Angle: ${angle}
- Naturally work in these keywords where they fit: ${keywords.join(", ")}
- At least ${limits.minSections} sections plus an intro section ("Introduction" not required as literal heading; first section acts as intro) and a "Practical tips" or "How to choose" style section.
- At least ${limits.minFaqs} FAQ items.
- Total body length between ${limits.minWords + 100} and ${limits.minWords + 400} words across sections (err on the longer side).
- Do NOT invent statistics, benchmark numbers, prices, or fake studies. General, hedged claims are fine.
- Do NOT include affiliate links; do not mention that you are an AI.`;

function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("no JSON object found in model output");
  return JSON.parse(raw.slice(start, end + 1));
}

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
// non-text Gemini models that must never be picked for article writing
const BAD_MODEL_RE = /embedding|aqa|imagen|veo|tts|audio|image|native|thinking|exp|learnlm|gemma|robotics|computer-use|live/i;

/** List models this API key can actually use (generateContent only). */
async function listGeminiModels(apiKey) {
  const { status, data } = await fetchWithRetry(
    `${GEMINI_BASE}/models?pageSize=1000&key=${encodeURIComponent(apiKey)}`,
    { method: "GET" },
    { attempts: 2, baseMs: 1500, timeoutMs: 20000 }
  );
  if (status !== 200 || !data?.models) throw new Error(`gemini ListModels HTTP ${status}`);
  return data.models
    .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
    .map((m) => m.name.replace(/^models\//, ""));
}

/** Pick the best generally-available chat model: prefer -latest aliases, then newest flash, then pro. */
function pickGeminiModel(models) {
  const rank = [
    (m) => /^gemini-flash-latest$/.test(m),
    (m) => /^gemini-[\d.]+-flash$/i.test(m),
    (m) => /flash/i.test(m) && !BAD_MODEL_RE.test(m),
    (m) => /pro/i.test(m) && !BAD_MODEL_RE.test(m),
  ];
  for (const r of rank) {
    const hits = models.filter(r).sort((a, b) => b.localeCompare(a));
    if (hits.length) return hits[0];
  }
  return models[0];
}

async function callGemini(apiKey, userPrompt, cfg) {
  const available = await listGeminiModels(apiKey);
  if (!available.length) throw new Error("gemini: key has no generateContent models");
  const configured = cfg.primary?.model;
  const best = configured && configured !== "auto" && available.includes(configured)
    ? configured
    : pickGeminiModel(available);

  // cascade: preferred model first, then up to 3 alternates — free-tier 503/429s are
  // per-model capacity, so rotating models beats retrying one. Only the gemini text
  // family qualifies (excludes image/audio/embedding models like nano-banana, lyria).
  const alternates = available
    .filter((m) => /^gemini/i.test(m) && m !== best && /flash|pro/i.test(m) && !BAD_MODEL_RE.test(m))
    .sort((a, b) => {
      const p = (m) => (/preview/i.test(m) ? 1 : 0); // stable releases first
      return p(a) - p(b) || b.localeCompare(a);
    });
  const candidates = [best, ...alternates].slice(0, 4);

  let lastErr = null;
  for (let i = 0; i < candidates.length; i++) {
    const model = candidates[i];
    try {
      const { status, data } = await fetchWithRetry(
        `${GEMINI_BASE}/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: SYSTEM }] },
            contents: [{ role: "user", parts: [{ text: userPrompt }] }],
            generationConfig: {
              temperature: 0.7,
              maxOutputTokens: cfg.maxOutputTokens,
              responseMimeType: "application/json",
            },
          }),
        },
        // fail fast on alternates; only the preferred model earns backoff retries
        { attempts: i === 0 ? cfg.backoffMaxAttempts : 1, baseMs: cfg.backoffBaseMs, timeoutMs: cfg.requestTimeoutMs },
      );
      if (status !== 200 || !data) throw new Error(`HTTP ${status}`);
      const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") ?? "";
      if (!text) throw new Error("empty content (possibly blocked or token limit)");
      console.log(`[llm] gemini model used: ${model}`);
      return extractJson(text);
    } catch (err) {
      lastErr = `${model}: ${err.message}`;
      console.error(`[llm] gemini ${lastErr} — trying next model`);
    }
  }
  throw new Error(`gemini all models failed — ${lastErr}`);
}

async function callOpenRouter(endpoint, apiKey, userPrompt, cfg) {
  const { status, data } = await fetchWithRetry(
    endpoint,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://github.com",
        "X-Title": "ai-tools-content-autopilot",
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.7,
        max_tokens: cfg.maxOutputTokens,
      }),
    },
    { attempts: cfg.backoffMaxAttempts, baseMs: cfg.backoffBaseMs, timeoutMs: cfg.requestTimeoutMs },
  );
  if (status !== 200 || !data) throw new Error(`openrouter HTTP ${status}`);
  const text = data?.choices?.[0]?.message?.content ?? "";
  if (!text) throw new Error("openrouter returned empty content");
  return extractJson(text);
}

/**
 * validateArticle — quality gate. Throws with a reason list if the article is not publishable.
 */
export function validateArticle(art, limits) {
  const errs = [];
  const bodyMd = (art.sections || []).map((s) => `${s.heading}\n${s.body || ""}`).join("\n");
  const words = wordCount(bodyMd) + wordCount((art.faq || []).map((f) => `${f.q} ${f.a}`).join("\n"));
  if (!art.title || art.title.length < 20) errs.push("title too short/missing");
  if (!art.metaDescription || art.metaDescription.length < 50) errs.push("metaDescription too short/missing");
  if (!Array.isArray(art.sections) || art.sections.length < limits.minSections) errs.push(`needs >= ${limits.minSections} sections`);
  if (words < limits.minWords) errs.push(`needs >= ${limits.minWords} words (got ${words})`);
  if (!Array.isArray(art.faq) || art.faq.length < limits.minFaqs) errs.push(`needs >= ${limits.minFaqs} FAQs`);
  if (errs.length) throw new Error("quality gate failed: " + errs.join("; "));
  return { ...art, _wordCount: words };
}

/**
 * generateArticle — primary provider with fallback; throws after both fail.
 * @param {object} config full config.json content
 * @param {object} sel { topic, angle }
 * @param {object} log optional logger fn(event, detail)
 * @returns {object} validated article
 */
export async function generateArticle(config, sel, log = () => {}) {
  const llm = config.llm;
  const userPrompt = USER_TMPL(sel.topic, sel.angle, config.keywords, config.limits);

  const providers = [];
  if (process.env.GEMINI_API_KEY) {
    providers.push({ name: llm.primary.provider, call: (prompt) => callGemini(process.env.GEMINI_API_KEY, prompt, llm) });
  }
  if (process.env.OPENROUTER_API_KEY) {
    providers.push({ name: llm.fallback.provider, call: (prompt) => callOpenRouter(llm.fallback.endpoint, process.env.OPENROUTER_API_KEY, prompt, llm.fallback) });
  }
  if (!providers.length) {
    throw new Error("no LLM API keys configured (set GEMINI_API_KEY and/or OPENROUTER_API_KEY)");
  }

  const failures = [];
  for (let round = 0; round < 2; round++) {
    const prompt =
      round === 0
        ? userPrompt
        : userPrompt +
          `\n\nIMPORTANT: A previous draft was rejected for insufficient length. Write at least ${config.limits.minWords + 150} words. Expand each section with more concrete detail, examples, and edge cases.`;
    for (const p of providers) {
      try {
        log("provider", `trying ${p.name}${round ? " (retry round 2)" : ""}`);
        const art = await p.call(prompt);
        const validated = validateArticle(art, config.limits);
        log("provider", `${p.name} OK (${validated._wordCount} words)`);
        return { ...validated, _provider: p.name };
      } catch (err) {
        failures.push(`${p.name}: ${err.message}`);
        log("provider", `${p.name} failed: ${err.message}`);
      }
    }
  }
  throw new Error("all providers failed — " + failures.join(" | "));
}
