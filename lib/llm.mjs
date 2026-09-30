import { fetchWithRetry } from "./http.mjs";
import { wordCount } from "./markdown.mjs";

const SYSTEM = `You are the senior editor of a high-quality AI-tools publication. You write accurate, practical, specific articles. You never invent statistics, prices, or fake research. When unsure about a fact, you keep the claim general or clearly hedge it.`;

const USER_TMPL = (topic, angle, keywords, limits) => `Write a complete SEO article as STRICT JSON (no markdown fences, no commentary). Respond with ONLY a JSON object with exactly this shape:

{
  "title": "SEO title, 50-65 chars, compelling, no clickbait",
  "metaDescription": "150-160 chars summary",
  "tags": ["3-6 lowercase topical tags"],
  "sections": [
    { "heading": "section heading", "body": "markdown paragraphs; may include - bullet lists and **bold**. 150-300 words per section." }
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
- Total body length at least ${limits.minWords} words across sections.
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

async function callGemini(endpoint, apiKey, userPrompt, cfg) {
  const { status, data } = await fetchWithRetry(
    `${endpoint}?key=${encodeURIComponent(apiKey)}`,
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
    { attempts: cfg.backoffMaxAttempts, baseMs: cfg.backoffBaseMs, timeoutMs: cfg.requestTimeoutMs },
  );
  if (status !== 200 || !data) throw new Error(`gemini HTTP ${status}`);
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") ?? "";
  if (!text) throw new Error("gemini returned empty content (possibly blocked or token limit)");
  return extractJson(text);
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

  const providers = [
    { name: llm.primary.provider, call: () => callGemini(llm.primary.endpoint, process.env.GEMINI_API_KEY, userPrompt, llm) },
    { name: llm.fallback.provider, call: () => callOpenRouter(llm.fallback.endpoint, process.env.OPENROUTER_API_KEY, userPrompt, llm.fallback) },
  ];

  const failures = [];
  for (const p of providers) {
    try {
      log("provider", `trying ${p.name}`);
      const art = await p.call();
      const validated = validateArticle(art, config.limits);
      log("provider", `${p.name} OK (${validated._wordCount} words)`);
      return { ...validated, _provider: p.name };
    } catch (err) {
      failures.push(`${p.name}: ${err.message}`);
      log("provider", `${p.name} failed: ${err.message}`);
    }
  }
  throw new Error("all providers failed — " + failures.join(" | "));
}
