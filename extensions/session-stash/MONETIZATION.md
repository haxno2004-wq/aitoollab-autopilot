# Monetization — Session Stash Pro

The extension ships as a working free tier. Two proven ways to unlock revenue, both compatible with store rules (Google removed in-store payments years ago; external licensing is the standard).

## Option A — Gumroad (recommended — you already have an account)

Gumroad: 10% per sale, no monthly fee, auto-generated license keys. The extension already contains the full license-activation flow (`lib/license.js`).

1. Sign in at **gumroad.com** → Products → **New product**.
2. Name: `Session Stash Pro` · Price: **$7** · Type: **Digital product**.
3. Content: upload `releases/session-stash-1.0.0.zip` (buyers get the unpacked-source zip as a bonus, even though the store version is the paid unlock).
4. Publish, then copy two values from the product's **Share/Links** page:
   - the **product id** (from the API section or the URL of the product's dashboard page — a `UUID`)
   - the **permalink** (the `gumroad.com/l/<permalink>` link)
5. Paste the product id into `extensions/session-stash/lib/common.js`:
   ```js
   export const GUMROAD_PRODUCT_ID = "paste-id-here";
   ```
6. Paste the permalink into `lib/license.js` → `buyUrl()`.
7. Regenerate the zip (`tools/package.sh` or see LISTING.md) and upload the new version to the store.

**Flow after setup:** user clicks *Get Pro* → your Gumroad checkout → license key emailed → user pastes it in Settings → extension verifies against `api.gumroad.com/v2/licenses/verify`, unlocks, and re-verifies every 30 days (refund/cancel ⇒ auto-downgrade). The `https://api.gumroad.com/*` host permission is already declared.

**Testing:** buy your own product once (Gumroad makes it easy to 100%-discount it for yourself), activate, confirm the Pro banner, then issue a refund and confirm the downgrade on the next 30-day re-check (or after clearing storage).

## Option B — ExtensionPay (subscriptions instead of one-time)

If you'd rather charge $2/mo or $12/yr recurring:

1. Create an account at **extensionpay.com**, register your extension id, and set your prices there.
2. Download their `extension.js` SDK into `extensions/session-stash/vendor/extpay.js`.
3. Replace `activateLicense` calls in `manager.js` with:
   ```js
   const client = new ExtPay('your-extension-id');
   client.openPaymentPage();               // checkout popup
   const user = await client.getUser();    // user.paid → unlock
   ```
4. Set `GUMROAD_PRODUCT_ID = ""` to hide the Gumroad box.

ExtensionPay takes 5% + $0.50 per transaction, no monthly fee. Both options keep the free tier intact — the store rejects extensions whose only function is paywalling.

## What NOT to do

- Don't gate basic stash/restore — the store's "spam & placement" review penalizes crippled cores.
- Don't add ads. One-time or subscription only.
- Don't request more permissions than declared; each addition re-triggers review.
