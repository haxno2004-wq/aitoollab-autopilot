// Session Stash — background service worker (MV3, ES module).
// Responsibilities: capture snapshots (manual + autosave via alarms),
// prune old sessions, restore windows/tabs, and answer messages from the
// popup and manager pages.

import {
  STORAGE_KEYS,
  DEFAULT_SETTINGS,
  FREE_MAX_SESSIONS,
  FREE_MIN_INTERVAL_MIN,
  MAX_TABS_PER_SNAPSHOT,
  uid,
  sessionHash,
  canRestore,
  getSettings,
  saveSettings,
  getSessions,
  saveSessions,
  isPro,
  getProState,
} from "./lib/common.js";
import { refreshLicenseIfStale } from "./lib/license.js";

const ALARM = "autosave";
const RESTORE_CHUNK = 25;

// ---------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------

async function captureWindows() {
  const windows = await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] });
  const out = [];
  for (const w of windows) {
    const tabs = (w.tabs || [])
      .filter((t) => canRestore(t.url) || t.pinned)
      .slice(0, MAX_TABS_PER_SNAPSHOT)
      .map((t) => ({
        title: t.title || t.url || "Untitled",
        url: t.url || "",
        pinned: !!t.pinned,
        active: !!t.active,
      }));
    if (!tabs.length) continue;
    out.push({ incognito: !!w.incognito, tabs });
  }
  return out;
}

export async function snapshotNow({ auto = false } = {}) {
  const [windows, settings, pro] = await Promise.all([captureWindows(), getSettings(), isPro()]);
  if (!windows.length) return { ok: false, reason: "no-restorable-tabs" };

  const tabs = windows.flatMap((w) => w.tabs);
  const hash = sessionHash(tabs);

  if (auto) {
    const { [STORAGE_KEYS.lastAutoHash]: last } = await chrome.storage.local.get(
      STORAGE_KEYS.lastAutoHash
    );
    if (last === hash) return { ok: true, skipped: "unchanged" };
    await chrome.storage.local.set({ [STORAGE_KEYS.lastAutoHash]: hash });
  }

  const sessions = await getSessions();
  const freeCap = pro ? 10000 : FREE_MAX_SESSIONS;
  if (!auto && sessions.length >= freeCap) {
    return { ok: false, reason: "limit-reached", limit: freeCap, pro };
  }

  const session = {
    id: uid(),
    name: auto ? `Auto — ${new Date().toLocaleString()}` : `Stash — ${new Date().toLocaleString()}`,
    createdAt: Date.now(),
    auto,
    pinned: false,
    windows,
    tabCount: tabs.length,
    hash,
  };

  sessions.unshift(session);
  await prune(sessions, settings, pro);
  await saveSessions(sessions);
  updateBadge(sessions.length, pro ? null : freeCap);
  return { ok: true, id: session.id, count: sessions.length };
}

async function prune(sessions, settings, pro) {
  const cap = pro ? 10000 : Math.min(settings.maxSessions || FREE_MAX_SESSIONS, FREE_MAX_SESSIONS);
  let kept = 0;
  const out = [];
  // Newest first; keep pinned sessions always, then fill up to the cap.
  const ordered = [...sessions].sort((a, b) => b.createdAt - a.createdAt);
  for (const s of ordered) {
    if (s.pinned || kept < cap) {
      out.push(s);
      if (!s.pinned) kept++;
    }
  }
  sessions.length = 0;
  sessions.push(...out);
}

// ---------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------

async function restoreSession(id, { closeCurrent = false } = {}) {
  const sessions = await getSessions();
  const session = sessions.find((s) => s.id === id);
  if (!session) return { ok: false, reason: "not-found" };

  if (closeCurrent) {
    const current = await chrome.windows.getAll({ windowTypes: ["normal"] });
    if (current.length > 1) {
      // Only close extra windows when restoring into a clean slate.
      for (const w of current) await chrome.windows.remove(w.id).catch(() => {});
    }
  }

  let opened = 0;
  for (const w of session.windows) {
    const urls = w.tabs.map((t) => t.url).filter(canRestore);
    if (!urls.length) continue;
    let windowId = null;
    for (let i = 0; i < urls.length; i += RESTORE_CHUNK) {
      const chunk = urls.slice(i, i + RESTORE_CHUNK);
      if (windowId === null) {
        const win = await chrome.windows.create({ url: chunk, focused: i === 0 });
        windowId = win.id;
      } else {
        for (const u of chunk) {
          await chrome.tabs.create({ windowId, url: u }).catch(() => {});
        }
      }
      opened += chunk.length;
    }
    // Re-apply pinned state where possible.
    const winTabs = await chrome.tabs.query({ windowId });
    const pinnedUrls = new Set(w.tabs.filter((t) => t.pinned).map((t) => t.url));
    for (const t of winTabs) {
      if (pinnedUrls.has(t.url)) await chrome.tabs.update(t.id, { pinned: true }).catch(() => {});
    }
  }
  return { ok: true, opened };
}

async function restoreTab(url) {
  if (!canRestore(url)) return { ok: false, reason: "blocked-url" };
  await chrome.tabs.create({ url });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Session operations
// ---------------------------------------------------------------------------

async function deleteSession(id) {
  const sessions = (await getSessions()).filter((s) => s.id !== id);
  await saveSessions(sessions);
  updateBadge(sessions.length, (await isPro()) ? null : FREE_MAX_SESSIONS);
  return { ok: true };
}

async function renameSession(id, name) {
  const sessions = await getSessions();
  const s = sessions.find((x) => x.id === id);
  if (s) s.name = (name || "").trim().slice(0, 80) || s.name;
  await saveSessions(sessions);
  return { ok: true };
}

async function togglePin(id) {
  const sessions = await getSessions();
  const s = sessions.find((x) => x.id === id);
  if (s) s.pinned = !s.pinned;
  await saveSessions(sessions);
  return { ok: true, pinned: s ? s.pinned : false };
}

// ---------------------------------------------------------------------------
// Autosave
// ---------------------------------------------------------------------------

async function scheduleAutosave() {
  const settings = await getSettings();
  await chrome.alarms.clear(ALARM);
  if (!settings.auto) return;
  const minutes = Math.max(FREE_MIN_INTERVAL_MIN, settings.intervalMin || FREE_MIN_INTERVAL_MIN);
  chrome.alarms.create(ALARM, { periodInMinutes: minutes, delayInMinutes: minutes });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) {
    snapshotNow({ auto: true }).catch(() => {});
    refreshLicenseIfStale().catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------

function updateBadge(count, cap) {
  const text = cap ? `${Math.min(count, cap)}/${cap}` : `${count}`;
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color: "#0ea472" });
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(async () => {
  const { settings } = await chrome.storage.local.get(STORAGE_KEYS.settings);
  if (!settings) await chrome.storage.local.set({ [STORAGE_KEYS.settings]: DEFAULT_SETTINGS });
  const sessions = await getSessions();
  updateBadge(sessions.length, (await isPro()) ? null : FREE_MAX_SESSIONS);
  await scheduleAutosave();
});

chrome.runtime.onStartup.addListener(async () => {
  const sessions = await getSessions();
  updateBadge(sessions.length, (await isPro()) ? null : FREE_MAX_SESSIONS);
  await scheduleAutosave();
});

// ---------------------------------------------------------------------------
// Message router
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      switch (msg && msg.type) {
        case "bootstrap": {
          const [sessions, settings, proState] = await Promise.all([
            getSessions(),
            getSettings(),
            getProState(),
          ]);
          return { ok: true, sessions, settings, pro: proState };
        }
        case "stashNow":
          return await snapshotNow({ auto: false });
        case "restore":
          return await restoreSession(msg.id, { closeCurrent: !!msg.closeCurrent });
        case "restoreTab":
          return await restoreTab(msg.url);
        case "delete":
          return await deleteSession(msg.id);
        case "rename":
          return await renameSession(msg.id, msg.name);
        case "togglePin":
          return await togglePin(msg.id);
        case "setSettings": {
          const pro = await isPro();
          const patch = { ...msg.patch };
          if (!pro) {
            delete patch.maxSessions; // pro-only knob
            if (patch.intervalMin) patch.intervalMin = Math.max(patch.intervalMin, FREE_MIN_INTERVAL_MIN);
          }
          const settings = await saveSettings(patch);
          await scheduleAutosave();
          return { ok: true, settings };
        }
        case "export": {
          const [sessions, settings] = await Promise.all([getSessions(), getSettings()]);
          return { ok: true, data: { app: "session-stash", version: 1, exportedAt: new Date().toISOString(), settings, sessions } };
        }
        case "import": {
          const data = msg.data;
          if (!data || data.app !== "session-stash" || !Array.isArray(data.sessions)) {
            return { ok: false, reason: "bad-file" };
          }
          const existing = await getSessions();
          const byHash = new Map(existing.map((s) => [s.hash + "|" + s.createdAt, s]));
          let added = 0;
          for (const s of data.sessions) {
            const clean = {
              id: uid(),
              name: String(s.name || "Imported").slice(0, 80),
              createdAt: Number(s.createdAt) || Date.now(),
              auto: false,
              pinned: !!s.pinned,
              windows: Array.isArray(s.windows) ? s.windows : [],
              tabCount: Number(s.tabCount) || 0,
              hash: sessionHash((s.windows || []).flatMap((w) => w.tabs || [])),
            };
            if (byHash.has(clean.hash + "|" + clean.createdAt)) continue;
            existing.push(clean);
            byHash.set(clean.hash + "|" + clean.createdAt, clean);
            added++;
          }
          const pro = await isPro();
          await prune(existing, await getSettings(), pro);
          await saveSessions(existing);
          updateBadge(existing.length, pro ? null : FREE_MAX_SESSIONS);
          return { ok: true, added };
        }
        case "limits": {
          const pro = await isPro();
          return { ok: true, pro, freeMax: FREE_MAX_SESSIONS, freeMinInterval: FREE_MIN_INTERVAL_MIN };
        }
        default:
          return { ok: false, reason: "unknown-message" };
      }
    } catch (err) {
      return { ok: false, reason: String((err && err.message) || err) };
    }
  })();
  return true; // async sendResponse
});
