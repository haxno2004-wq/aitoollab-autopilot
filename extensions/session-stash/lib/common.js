// Session Stash — shared library.
// Everything is stored locally in chrome.storage.local. No network calls,
// except Gumroad license verification which only runs when the user
// explicitly enters a license key.

export const STORAGE_KEYS = {
  sessions: "sessions",
  settings: "settings",
  pro: "pro",
  lastAutoHash: "lastAutoHash",
};

export const FREE_MAX_SESSIONS = 20;
export const FREE_MIN_INTERVAL_MIN = 30;
export const FREE_AUTO_INTERVALS = [30, 60, 120];
export const PRO_AUTO_INTERVALS = [5, 10, 15, 30, 60, 120];
export const MAX_TABS_PER_SNAPSHOT = 500;

// Fill this in after creating the product on gumroad.com (see MONETIZATION.md).
// Leave empty to hide the license UI path and run the free tier only.
export const GUMROAD_PRODUCT_ID = "";

export const DEFAULT_SETTINGS = {
  auto: true,
  intervalMin: 30,
  maxSessions: FREE_MAX_SESSIONS,
  keepPinned: true,
};

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function fmtDate(ts) {
  const d = new Date(ts);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

// Hash used to detect "the tab set hasn't changed" so autosave doesn't
// create endless duplicate snapshots while the browser sits idle.
export function sessionHash(tabs) {
  const parts = tabs
    .map((t) => t.url || "")
    .filter(Boolean)
    .sort();
  let h = 5381;
  const s = parts.join("\n");
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export function canRestore(url) {
  if (!url) return false;
  if (url === "about:blank") return false;
  if (url.startsWith("chrome://newtab")) return false;
  if (url.startsWith("chrome-extension://")) return false;
  if (url.startsWith("devtools://")) return false;
  return /^(https?|file|ftp|chrome|edge|about):/i.test(url);
}

// ---------------------------------------------------------------------------
// Storage helpers (usable from the service worker and extension pages)
// ---------------------------------------------------------------------------

export async function getSettings() {
  const { settings } = await chrome.storage.local.get(STORAGE_KEYS.settings);
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

export async function saveSettings(patch) {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ [STORAGE_KEYS.settings]: next });
  return next;
}

export async function getSessions() {
  const { sessions } = await chrome.storage.local.get(STORAGE_KEYS.sessions);
  return sessions || [];
}

export async function saveSessions(sessions) {
  await chrome.storage.local.set({ [STORAGE_KEYS.sessions]: sessions });
}

export async function isPro() {
  const { pro } = await chrome.storage.local.get(STORAGE_KEYS.pro);
  return pro === true;
}

export async function setPro(value) {
  await chrome.storage.local.set({ [STORAGE_KEYS.pro]: value === true });
}

export async function getProState() {
  const { pro, license } = await chrome.storage.local.get(["pro", "license"]);
  return { pro: pro === true, license: license || null };
}

export async function saveLicense(license) {
  await chrome.storage.local.set({ license });
}
