# AI ToolLab — autonomous content autopilot

A **$0-cost, fully autonomous** pipeline: discovers trending AI-tools topics → writes quality SEO articles via free LLM tiers → publishes a static site on Cloudflare Pages → pings search engines → reports every run.

## Pipeline (each run, ~3 min)

```
discover (HN Algolia + GitHub trending, no keys)
   → select (dedupe vs history, angle picker)
   → generate (Gemini → OpenRouter fallback, strict JSON, quality gate)
   → build  (static HTML, JSON-LD Article+FAQ schema, sitemap, RSS, affiliate slots)
   → deploy (wrangler → Cloudflare Pages)
   → ping   (IndexNow: Bing/Yandex instant indexing)
   → report (CSV log + state + GitHub Step Summary, committed back to repo)
```

## Local dry-run (no API keys needed)

```bash
npm run run:dry
```

Runs the real discover → select → build pipeline using a fixture article, outputs to `public/`. Open `public/index.html` in a browser to inspect the site.

## Layout

```
config.json            site identity, niche keywords, affiliate map, AdSense, IndexNow, LLM config
scripts/discover.mjs   free keyless topic discovery (HN + GitHub)
scripts/select.mjs     topic pick + angle assignment
scripts/generate.mjs   LLM stage (provider chain + validation)
scripts/build.mjs      static site builder (full rebuild from content/)
scripts/indexnow.mjs   IndexNow ping
scripts/report.mjs     CSV/state/summary reporting
scripts/dryrun.mjs     keyless end-to-end test
lib/                   http retry, markdown, llm chain, state
site/assets/           CSS/JS/favicon (copied to public/ at build)
content/posts/         committed article archive — source of truth; every run rebuilds the whole site
.github/workflows/     twice-daily cron workflow
state/                 published slugs, used topics, run log (committed back)
```

## Monetization
- **Affiliate:** contextual "Tools worth trying" box on every article, FTC disclosure everywhere, weekly rotation. Put your IDs in `config.json → affiliate.links`.
- **AdSense:** pre-wired; flip `adsense.enabled` and paste your client id when approved.

## Guardrails
- Quality gate: ≥800 words, ≥3 sections, ≥3 FAQs, else the run is skipped — it never publishes garbage.
- Honesty rules in the system prompt: no invented stats/prices/studies.
- Every run is transparent: log + report + committed state in the repo.
