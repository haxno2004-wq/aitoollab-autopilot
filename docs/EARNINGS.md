# Earnings — where the money actually shows up, and when

The bot automates everything up to the point where a stranger clicks an affiliate link or an ad.
The money itself lands in **third-party dashboards you own**. This page is your map.

## The honest math

```
articles (free, automated) → Google/Bing index them → rankings climb over weeks
  → visitors arrive (search) → click affiliate links / ads → commissions
```

SEO is a compounding, probabilistic channel:

| Phase | Timeframe | What to expect |
|---|---|---|
| Indexing | days 1–14 | Pages appear in Google/Bing; near-zero traffic |
| Traction | weeks 2–8 | First long-tail impressions; a handful of clicks/day |
| Compounding | months 2–6 | Steady organic traffic if articles target real questions |
| Revenue | typically month 2+ | First affiliate clicks → first commissions |

There is no guarantee — topics, competition, and search demand all vary. What this system
guarantees is **maximum shots on goal at zero cost**: ~60 quality articles/month, indexed fast,
every run logged and inspectable.

## Check the bot's output (this repo)

```bash
npm run status        # terminal dashboard: articles, runs, words, monetization switches
```

Ground truth also lives in:
- `state/state.json` — every published slug + topic ever used
- `state/log.csv` — one row per run (success/skip, provider, word count)
- GitHub → **Actions** tab → each run leaves a full report in its summary
- Your live site: `https://aitoollab.pages.dev` (+ `/sitemap.xml`, `/rss.xml`)

## Check the money (external dashboards)

| Program | Where to look | When it pays |
|---|---|---|
| Affiliate programs (ElevenLabs, Notion, Jasper, Descript, Perplexity, Framer, Grammarly, Zapier) | each program's dashboard → clicks, conversions, balance | usually monthly, after you cross their payout threshold |
| Google AdSense | [adsense.google.com](https://adsense.google.com) → Performance | monthly (≥$100 threshold) |
| Bing indexing health | [bing.com/webmasters](https://www.bing.com/webmasters) → Search Performance | — (traffic signal, not money) |
| Google indexing health | [search.google.com/search-console](https://search.google.com/search-console) → Performance | — (traffic signal, not money) |

## The two switches that turn on earning

1. **Affiliate IDs** — `config.json → affiliate.links`: replace `YOUR_ID` with your referral ID
   from each program. Until then links are clean, untracked links (no earning, no harm).
2. **AdSense** — after the site has a few weeks of content, apply at
   [adsense.google.com](https://adsense.google.com). When approved:
   `config.json → adsense.enabled = true` + paste your `ca-pub-…` client id.

Check switch state any time with `npm run status`.

## Scaling levers (all still $0)

- **More shots on goal:** add cron entries in `.github/workflows/earn.yml` (each run = 1 article)
- **Faster indexing:** keep IndexNow enabled; submit sitemap in Search Console + Bing
- **Better targeting:** watch Search Console for queries you almost rank for — add a
  config keyword for that cluster and the selector will gravitate toward it
- **Multi-site:** duplicate the repo with a different niche in `config.json` — the pipeline is site-agnostic
