# Session Stash — Tab Session Manager

Save, search and restore your browser tab sessions — automatically. **100% local and private**: no account, no cloud, no tracking. Manifest V3 extension for Chrome/Edge (Firefox notes below).

## Why

Chrome's built-in "continue where you left off" is all-or-nothing. There was no clean way to snapshot *this exact set of windows* — a project, a research burst, a weekend tab pile — name it, and bring it back later. The most-loved session managers died in the Manifest V3 cleanup (one had 48,000+ active users), and the survivors are heavy or cloud-tied. Session Stash is the lean, local, MV3-native answer.

## Features

- **Stash now** — capture every window + tab (titles, URLs, pinned state) in one click
- **Autosave** — periodic snapshots (30/60/120 min on free; down to 5 min on Pro), skipped automatically when nothing changed
- **Restore** — reopen a whole session (windows recreated, pinned tabs re-pinned) or a single tab
- **Search** — across session names, tab titles and URLs
- **Pin** — protect favorite sessions from auto-pruning
- **Export / Import** — JSON backup (Pro)
- **Badge counter** — sessions/limit at a glance
- **Zero network** — everything in `chrome.storage.local`; the only outbound call ever is an optional Gumroad license check you trigger yourself

## Free vs Pro

| | Free | Pro (one-time) |
|---|---|---|
| Stored sessions | 20 | Unlimited |
| Autosave interval | 30 min min | down to 5 min |
| Export / Import | — | ✓ |
| Price | — | $7 one-time |

The free tier is fully usable forever — no nags, no account, no telemetry.

## Install (unpacked, 30 seconds)

1. Download/clone this folder.
2. Open `chrome://extensions` (or `edge://extensions`).
3. Enable **Developer mode** (top right).
4. Click **Load unpacked** → select the `session-stash` folder (the one containing `manifest.json`).
5. Pin it from the puzzle-piece menu. Done.

## Firefox

Same code works with two changes: in `manifest.json`, replace the `background` block with `"background": { "scripts": ["background.js"] }` (Firefox MV3 uses event pages, not service workers) and remove the `"favicon"` permission plus favicon `<img>` tags (Firefox has no `/_favicon/` endpoint — the rows render fine without them). Not yet tested on AMO.

## Files

```
manifest.json      MV3 manifest (permissions: tabs, storage, alarms, favicon)
background.js      service worker: capture / autosave alarms / prune / restore / message router
lib/common.js      storage, settings, limits, hashing
lib/license.js     optional Gumroad license activation + 30-day re-verification
popup.html/.js     toolbar popup: stash, search, quick restore
manager.html/.js   full dashboard: sessions, settings, export/import, license
ui.css             shared dark UI
tools/gen-icons.mjs  regenerates icons (node tools/gen-icons.mjs)
tools/pack.py        builds the release zip (python tools/pack.py)
tools/smoke.mjs      headless behaviour test against a mock chrome API
```

## Verify it yourself

```bash
node extensions/session-stash/tools/smoke.mjs   # 20 checks: capture, dedupe, restore, limits
python extensions/session-stash/tools/pack.py   # rebuild releases/session-stash-1.0.0.zip
```

The smoke test stubs `chrome.storage` / `chrome.windows` / `chrome.tabs` / `chrome.runtime` and drives the real service-worker code, so it needs no browser. It covers snapshot creation, non-restorable URL filtering, pinned-state capture, autosave dedupe, window-per-session restore, the message router (bootstrap / export / import / settings gating), and the free 20-session cap.

## Publishing to the Chrome Web Store

See `LISTING.md` for ready-to-paste store copy, the privacy policy text, and the exact publish checklist. You need your own Chrome Web Store developer account (one-time $5 fee at https://chromewebstore.google.com/for publishers — registration at developer.chrome.com). The store-ready zip is at `releases/session-stash-1.0.0.zip`.

## Monetization

See `MONETIZATION.md`. Short version: create one $7 product on your Gumroad account, paste its product id into `lib/common.js`, rebuild, done — the extension's Upgrade card and license activation go live. ExtensionPay is documented as an alternative.
