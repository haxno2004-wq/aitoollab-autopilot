# Chrome Web Store listing kit — Session Stash

## Publish checklist (15 minutes)

1. Register as a CWS developer: https://chromewebstore.google.com/publish — one-time **$5** fee.
2. Zip already built: `releases/session-stash-1.0.0.zip` (manifest at zip root — required).
3. Developer Dashboard → **New item** → upload the zip.
4. Store listing: paste the copy below; upload the icon (use `icons/icon128.png`) + 1–3 screenshots (see below).
5. Privacy tab:
   - Single purpose: *"Saves and restores your tab sessions locally."*
   - `tabs`: "Reads open tab titles/URLs to save and restore your sessions."
   - `storage`: "Stores your sessions on your device."
   - `alarms`: "Runs your chosen automatic snapshot schedule."
   - `favicon`: "Shows site icons of saved tabs — rendered locally from your browser cache."
   - `api.gumroad.com`: "Only used when you enter a license key to activate Pro."
   - Data usage: **does not collect user data, no analytics, no remote code.** ✔ all boxes accordingly.
6. Distribution: public. Submit. Review typically 1–3 business days for this permission set.

## Store listing copy (paste-ready)

**Title** (45 max): `Session Stash — Tab Session Manager`

**Short description** (132 max):
> Snapshot & restore your tabs automatically. 100% local & private — no account, no cloud. The MV3 session manager Chrome lost.

**Category:** Productivity · **Language:** English

**Detailed description:**
> Your browser restarts, Chrome eats your tabs, you juggle five project windows — and "continue where you left off" only gives you everything back, undifferentiated.
>
> Session Stash snapshots your exact windows + tabs, names them, and brings any of them back in one click — locally, privately, forever.
>
> ▶ WHAT IT DOES
> • One-click "Stash" of every window and tab (titles, URLs, pinned state)
> • Automatic snapshots on your schedule — skipped when nothing changed
> • Restore a whole session (windows + pinned tabs rebuilt) or any single tab
> • Search across session names, tab titles and URLs
> • Pin the sessions you never want pruned
> • Sessions/limit badge right on the toolbar icon
>
> ▶ WHY IT'S DIFFERENT
> • 100% local — your tab history never leaves your device. No account, no sync server, no telemetry.
> • Built for Manifest V3 from day one — fast, tiny, no background bloat.
> • The free tier is genuinely usable forever (20 sessions). Pro is a one-time $7 — unlimited sessions, 5-minute autosave, JSON export/import. No subscription.
>
> ▶ PRIVACY
> The extension makes no network requests of its own. The only outbound call possible is an optional license-key check with Gumroad, and it happens only when you choose to activate Pro.
>
> Rebuild your research bursts, work sessions and weekend tab piles on demand. Stash once, restore anytime.

**Screenshots:** 1280×800 or 640×400. Take three: (1) manager with a few colorful sessions, (2) the popup mid-stash, (3) restore-in-action before/after. Load the unpacked extension, open `manager.html`, fill a few sessions, and screenshot with the browser's own capture tool.

**Privacy policy URL:** host `PRIVACY-POLICY.md`'s text anywhere (GitHub Pages from this repo is fine) or use the store's "privacy practices" fields alone — with zero data collection, a URL is optional but recommended.

## Version bumping

Edit `version` in `manifest.json` (e.g. 1.0.1), re-run the zip command from `LISTING.md` §zip, upload. Store review for permission-free updates is usually fast.

## zip command (used to build releases/session-stash-1.0.0.zip)

```
cd extensions/session-stash
tar -a -c -f releases/session-stash-1.0.0.zip --exclude=tools --exclude=releases --exclude='.*' *
```
