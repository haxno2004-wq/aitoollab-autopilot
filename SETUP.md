# SETUP — go live in ~10 minutes

The bot is fully autonomous once configured. You do these **one-time** steps:

## 1. Push to GitHub
Create a new repo and push this project to it.

## 2. Add the free API keys (GitHub → Settings → Secrets and variables → Actions)

| Secret | Required | Where to get it |
|---|---|---|
| `GEMINI_API_KEY` | yes | [aistudio.google.com](https://aistudio.google.com) → Get API key (free tier is enough; the bot publishes only 1 article/run) |
| `CLOUDFLARE_API_TOKEN` | yes | Cloudflare dashboard → My Profile → API Tokens → "Edit Cloudflare Workers" template, then add **Account › Cloudflare Pages › Edit** permission |
| `CLOUDFLARE_ACCOUNT_ID` | yes | Cloudflare dashboard → Workers & Pages (right sidebar) |
| `OPENROUTER_API_KEY` | optional | [openrouter.ai](https://openrouter.ai) → Keys → create (free). Used only if Gemini fails/rate-limits |
| `INDEXNOW_KEY` | optional | Any UUID works, e.g. `uuidgen` output. Also paste the same value into `config.json → indexnow.key` |

## 3. First deploy
GitHub → **Actions** → *Earning autopilot* → **Run workflow** (this is `workflow_dispatch`).
The first run creates the `aitoollab` Pages project automatically and publishes the first article.

Your site will be at `https://aitoollab.pages.dev` (or set a custom domain in Cloudflare → Pages → aitoollab → Custom domains).

> **Note:** if you rename the Pages project, also update `config.json → site.url` so canonical URLs, sitemap, RSS and IndexNow pings all match.

## 4. Verify in Search Console / Bing Webmaster (recommended, still free)
- **Google:** [search.google.com/search-console](https://search.google.com/search-console) → add property → verify (Cloudflare DNS TXT record is easiest) → submit `https://aitoollab.pages.dev/sitemap.xml`
- **Bing:** [bing.com/webmasters](https://www.bing.com/webmasters) → import from Search Console. IndexNow pings then accelerate Bing indexing.

## 5. Monetization switches (later, optional)
- **Affiliate programs** (ElevenLabs, Notion, Jasper, Descript, Perplexity, Framer, Grammarly, Zapier all have programs): replace `YOUR_ID` in `config.json → affiliate.links` with your real referral IDs. Until then the links are clean plain links with no tracking.
- **AdSense** (needs ~quality traffic first — apply after a few weeks): set `config.json → adsense.enabled = true` and paste your `client` id (`ca-pub-...`). Ad slots are already wired into every page.

## 6. What happens every day, without you
- **06:17 & 18:17 UTC**: bot discovers trending AI-tools topics → picks one it hasn't covered → writes an 800+ word article with FAQ → passes a quality gate → publishes to your site → pings IndexNow → commits the log to the repo → leaves a run report in the Actions summary.
- Failures degrade gracefully: Gemini fails → OpenRouter; both fail → run is skipped and logged, never publish garbage.
- Every article, log line, and report is visible in your repo and Actions tab. Total cost: **$0**.

## Changing volume
Defaults: 2 articles/day (2 runs × 1 article). To change:
- **3/day:** add a third `cron` line to `.github/workflows/earn.yml` (e.g. `17 12 * * *`).
- **1/day:** delete the second cron line.
