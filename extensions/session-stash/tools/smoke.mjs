// Session Stash — service-worker smoke test.
//
// Chrome is not required: this installs a small mock of the chrome.* APIs the
// worker actually uses, imports background.js as a module, and drives the real
// capture / dedupe / restore / limit logic end to end.
//
// Usage:  node extensions/session-stash/tools/smoke.mjs

import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";

const store = new Map();
const calls = { windowsCreated: [], tabsCreated: [], tabsPinned: [], windowsRemoved: [], badge: [] };
const listeners = {};
let liveWindows = [];
let nextWindowId = 100;

const chromeMock = {
  storage: {
    local: {
      async get(keys) {
        if (typeof keys === "string") return { [keys]: store.get(keys) };
        if (Array.isArray(keys)) return Object.fromEntries(keys.map((k) => [k, store.get(k)]));
        const out = {};
        for (const k of Object.keys(keys || {})) out[k] = store.has(k) ? store.get(k) : keys[k];
        return out;
      },
      async set(obj) {
        for (const [k, v] of Object.entries(obj)) store.set(k, v);
      },
    },
  },
  windows: {
    async getAll() {
      return liveWindows;
    },
    async create({ url }) {
      const id = nextWindowId++;
      const urls = Array.isArray(url) ? url : [url];
      calls.windowsCreated.push(urls);
      urls.forEach((u) => calls.tabsCreated.push(u));
      return { id };
    },
    async remove(id) {
      calls.windowsRemoved.push(id);
      liveWindows = liveWindows.filter((w) => w.id !== id);
    },
  },
  tabs: {
    async create({ url }) {
      calls.tabsCreated.push(url);
    },
    async query({ windowId }) {
      return (calls.windowsCreated.at(-1) || []).map((url, i) => ({ id: 1000 + i, url, windowId }));
    },
    async update(id, patch) {
      if (patch.pinned) calls.tabsPinned.push(id);
    },
  },
  alarms: {
    onAlarm: { addListener: (fn) => (listeners.alarm = fn) },
    async clear() {},
    create() {},
  },
  runtime: {
    onInstalled: { addListener: (fn) => (listeners.installed = fn) },
    onStartup: { addListener: (fn) => (listeners.startup = fn) },
    onMessage: { addListener: (fn) => (listeners.message = fn) },
  },
  action: {
    setBadgeText(o) {
      calls.badge.push(o.text);
    },
    setBadgeBackgroundColor() {},
  },
};

globalThis.chrome = chromeMock;

const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const send = (msg) =>
  new Promise((resolve) => {
    const timer = setTimeout(
      () => resolve({ ok: false, reason: `timeout waiting for response to ${msg.type}` }),
      3000
    );
    const done = (value) => {
      clearTimeout(timer);
      resolve(value);
    };
    let returned;
    try {
      returned = listeners.message(msg, {}, done);
    } catch (err) {
      done({ ok: false, reason: `threw: ${err && err.message}` });
      return;
    }
    if (returned !== true) done({ ok: false, reason: "listener-did-not-return-true" });
  });

const backgroundPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "background.js");
const bg = await import(pathToFileURL(backgroundPath).href);

// --- fixtures -----------------------------------------------------------------
const originalTabs = [
  { url: "https://news.ycombinator.com/", title: "HN", active: true },
  { url: "https://github.com/haxno2004-wq", title: "GitHub" },
  { url: "https://example.com/pricing", title: "Pricing", pinned: true },
  { url: "chrome://newtab/", title: "New tab" },
  { url: "about:blank", title: "Blank" },
];
liveWindows = [{ id: 1, incognito: false, tabs: originalTabs }];

// --- capture ------------------------------------------------------------------
const first = await bg.snapshotNow({});
check("stash creates a session", first.ok === true && typeof first.id === "string", JSON.stringify(first));
check("first snapshot report count", first.count === 1, `count=${first.count}`);

const [{ sessions: stored1 }] = [await chromeMock.storage.local.get("sessions")];
check("one session persisted", stored1.length === 1, `len=${stored1.length}`);
check(
  "non-restorable tabs filtered (chrome://, about:blank)",
  stored1[0].tabCount === 3,
  `tabCount=${stored1[0].tabCount} urls=${stored1[0].windows[0].tabs.map((t) => t.url).join(",")}`
);
check("pinned state captured", stored1[0].windows[0].tabs.some((t) => t.pinned && t.url.includes("example.com")));
check("badge updated", calls.badge.at(-1) === "1/20", `badge=${calls.badge.at(-1)}`);

// --- autosave dedupe ----------------------------------------------------------
const auto1 = await bg.snapshotNow({ auto: true });
check("autosave records first snapshot", auto1.ok === true && !auto1.skipped, JSON.stringify(auto1));
const auto2 = await bg.snapshotNow({ auto: true });
check("autosave skips unchanged tab set", auto2.ok === true && auto2.skipped === "unchanged", JSON.stringify(auto2));

// --- restore ------------------------------------------------------------------
calls.windowsCreated.length = 0;
calls.tabsCreated.length = 0;
calls.tabsPinned.length = 0;
const restored = await send({ type: "restore", id: first.id });
check("restore opens the saved tabs", restored.ok === true && restored.opened === 3, JSON.stringify(restored));
check("restore used one window", calls.windowsCreated.length === 1, `windows=${calls.windowsCreated.length}`);
check("restore re-pins the pinned tab", calls.tabsPinned.length === 1, `pinned=${calls.tabsPinned.length}`);

const missing = await send({ type: "restore", id: "does-not-exist" });
check("restore of unknown id fails cleanly", missing.ok === false && missing.reason === "not-found", JSON.stringify(missing));

// --- message router -----------------------------------------------------------
const boot = await send({ type: "bootstrap" });
check(
  "bootstrap returns sessions + settings + pro state",
  boot.ok === true &&
    Array.isArray(boot.sessions) &&
    boot.settings.intervalMin === 30 &&
    boot.pro.pro === false &&
    boot.pro.license === null,
  JSON.stringify({ ok: boot.ok, sessions: boot.sessions.length, pro: boot.pro })
);

const badMsg = await send({ type: "nope" });
check("unknown message rejected", badMsg.ok === false && badMsg.reason === "unknown-message", JSON.stringify(badMsg));

const exp = await send({ type: "export" });
check("export produces a tagged backup", exp.ok === true && exp.data.app === "session-stash" && exp.data.sessions.length >= 1);
const imp = await send({ type: "import", data: exp.data });
check("import of own export is idempotent", imp.ok === true && imp.added === 0, `added=${imp.added}`);

// --- settings gating ----------------------------------------------------------
const set = await send({ type: "setSettings", patch: { intervalMin: 1, maxSessions: 999 } });
check(
  "free tier clamps interval and hides maxSessions",
  set.ok === true && set.settings.intervalMin === 30 && set.settings.maxSessions === 20,
  JSON.stringify(set.settings)
);

// --- free session cap ---------------------------------------------------------
liveWindows = [{ id: 2, incognito: false, tabs: [{ url: "https://site-a.example.com/" }] }];
let capHit = null;
for (let i = 0; i < 20; i++) {
  liveWindows[0].tabs = [{ url: `https://site-${i}.example.com/` }];
  capHit = await bg.snapshotNow({});
}
check("free tier stops at 20 sessions", capHit.ok === false && capHit.reason === "limit-reached", JSON.stringify(capHit));
const afterCap = await chromeMock.storage.local.get("sessions");
check("cap enforced in storage", afterCap.sessions.length === 20, `len=${afterCap.sessions.length}`);

const pinnedSessions = afterCap.sessions;
const kept = await send({ type: "togglePin", id: pinnedSessions[0].id });
check("togglePin flips pinned", kept.ok === true && kept.pinned === true, JSON.stringify(kept));

// --- summary ------------------------------------------------------------------
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("failed:", failed.map((f) => f.name).join(" | "));
  process.exit(1);
}
