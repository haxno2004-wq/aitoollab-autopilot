# Monetization setup — payments, ads, affiliates

One-stop checklist for making every money path on the fleet actually pay.
Sources verified October 2026 (links inline).

## 1. Your AdSense publisher ID (`ca-pub-…`)

Step by step (from Google's own docs):

1. Sign up at **https://adsense.google.com** with your Google account and
   add one fleet site (e.g. `https://haxno2004-wq.github.io/aero-content-agent/`)
   under **Sites → + New site**.
2. Verify the site: paste the AdSense code snippet (or the `<head>` meta tag)
   into the site, or serve the `ads.txt` at the domain root, then request
   review. [Add a site](https://support.google.com/adsense/answer/12169212)
3. After approval, copy the ID from **Account → Settings → Account information
   → Publisher ID** (`pub-…`). The ad-code form is `ca-pub-` + the same
   number. [Find your publisher ID](https://support.google.com/adsense/answer/105516)
4. Where to paste it on the fleet:
   - Platform sites (`*.pages.dev`): `platforms/<platform>/config.json` →
     `"adsense": { "enabled": true, "client": "ca-pub-XXXXXXXX" }` — the
     generator (scripts/build.mjs) emits the ad script on every page.
   - Aero site: `_config.yml` → `adsense_client` (wired in `_layouts`), plus
     `ads.txt` at that repo's root.
5. Quality bar for approval: Google has **no minimum post count**, but requires
   substantial original value, easy navigation, and curates auto-generated
   content — our pipeline's quality gate and per-article review satisfy the
   "not merely auto-generated" requirement
   ([content policy](https://support.google.com/adsense/answer/10015918),
   [ads on low-value content](https://support.google.com/publisherpolicies/answer/11112688)).

## 2. Product payments (PayPal, via Gumroad)

Gumroad supports **PayPal as a payout destination where offered for your
country** — set it in **Gumroad → Settings → Payouts**
([getting paid](https://gumroad.com/help/article/13-getting-paid),
[payout settings](https://gumroad.com/help/article/260-your-payout-settings-page)).
Fees: **10% + $0.50 per sale** plus processing (~2.9% + $0.30);
Discover-attributed sales 30% ([pricing](https://gumroad.com/pricing)).

Why product pages might say *"Checkout link pending"* and how to fix:

- Root cause fixed in code (Oct 2026): `scripts/store.mjs` crashed with
  `saveState is not defined`, so Gumroad product URLs were never persisted.
- To have future products auto-created **with** checkout links, add repo
  secret `GUMROAD_ACCESS_TOKEN` (Gumroad → Settings → API → generate token).
  Products arrive as **drafts** (`publish: false`); you review and click
  publish — PayPal payout then applies automatically.
- For the **5 existing products** (all `buyUrl: null`): open the Gumroad
  dashboard, select each product, **Copy URL** (they look like
  `https://yourname.gumroad.com/l/product-slug`)
  ([find your product's URL](https://gumroad.com/help/article/136-find-your-products-url)),
  then paste it into the product JSON's `"buyUrl"` field in
  `content/labstore/products/*.json`.
- Store-wide fallback: set `gumroad.storeUrl` in
  `platforms/labstore/config.json` to your Gumroad profile/store URL — every
  product page without its own `buyUrl` then shows a working **Buy on the
  Gumroad store** button.

## 3. Affiliate IDs (replace every `YOUR_ID`)

The platform sites rotate real tools but some referral links still contain
`YOUR_ID`. Replace them in each `platforms/<platform>/config.json` →
`affiliate.links[].url`. Verified programs (October 2026):

| Program | Pay | Join |
|---|---|---|
| Synthesia (AI video) | 25% of payments, 60-day cookie | [affiliate page](https://www.synthesia.io/partners/affiliates) |
| DigitalOcean | 10% of referred spend, 12 months (via CJ) | [affiliates](https://www.digitalocean.com/affiliates) |
| Rocket Money | $4–$10 per funded signup (via Impact) | [affiliates](https://www.rocketmoney.com/affiliates) |
| YNAB | rate unpublished, invite-only | [partnerships](https://www.ynab.com/press/partnerships) |

FTC/Google placement rule: keep disclosures near the links (the built-in
`affiliate.disclosure` renders in the pick-box and footer) — see
[FTC endorsement FAQ](https://www.ftc.gov/business-guidance/resources/ftcs-endorsement-guides-what-people-are-asking).

## 4. Checklist

- [ ] AdSense account approved → paste `ca-pub-…` into one aero config + platform configs
- [ ] Gumroad token → repo secret `GUMROAD_ACCESS_TOKEN`
- [ ] PayPal connected in Gumroad payouts
- [ ] 5 existing products: paste real `buyUrl` (or set `gumroad.storeUrl`)
- [ ] Affiliate `YOUR_ID`s replaced with real referral IDs
