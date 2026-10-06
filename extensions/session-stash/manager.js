import { fmtDate, hostOf, FREE_MAX_SESSIONS, FREE_AUTO_INTERVALS, PRO_AUTO_INTERVALS } from "./lib/common.js";
import { billingConfigured, buyUrl, activateLicense, deactivateLicense } from "./lib/license.js";

const $ = (s) => document.querySelector(s);
const send = (m) => chrome.runtime.sendMessage(m);

let state = { sessions: [], settings: {}, pro: false };

function msg(text, isErr = false) {
  const el = $("#action-msg");
  el.hidden = !text;
  el.textContent = text || "";
  el.style.color = isErr ? "var(--warn)" : "var(--accent)";
  if (text) setTimeout(() => { el.hidden = true; }, 4000);
}

function card(s) {
  const el = document.createElement("div");
  el.className = "card" + (s.pinned ? " pinned" : "");

  const top = document.createElement("div");
  top.className = "top";
  const meta = document.createElement("div");
  meta.style.minWidth = "0";
  const name = document.createElement("div");
  name.className = "name";
  name.textContent = s.name;
  name.title = "Click to rename";
  name.style.cursor = "pointer";
  name.addEventListener("click", async () => {
    const next = prompt("Rename session", s.name);
    if (next && next.trim()) { await send({ type: "rename", id: s.id, name: next }); boot(); }
  });
  const sub = document.createElement("div");
  sub.className = "sub muted";
  sub.textContent = `${s.tabCount} tabs · ${fmtDate(s.createdAt)}${s.auto ? " · auto" : ""}`;
  meta.append(name, sub);
  const pin = document.createElement("button");
  pin.className = "icon-btn";
  pin.title = "Pin (never auto-pruned)";
  pin.textContent = s.pinned ? "📌" : "📍";
  pin.addEventListener("click", async () => { await send({ type: "togglePin", id: s.id }); boot(); });
  top.append(meta, pin);

  const favRow = document.createElement("div");
  favRow.className = "fav-row";
  const seen = new Set();
  outer: for (const w of s.windows || []) {
    for (const t of w.tabs || []) {
      const host = hostOf(t.url);
      if (!host || seen.has(host)) continue;
      seen.add(host);
      const img = document.createElement("img");
      img.src = chrome.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(new URL(t.url).origin)}&size=32`);
      img.width = 16; img.height = 16; img.alt = ""; img.loading = "lazy";
      favRow.appendChild(img);
      if (favRow.children.length >= 10) break outer;
    }
  }

  const details = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = `${s.tabCount} tabs`;
  summary.className = "muted";
  summary.style.cursor = "pointer";
  const ul = document.createElement("ul");
  ul.className = "tabs-list";
  for (const w of s.windows || []) {
    for (const t of w.tabs || []) {
      const li = document.createElement("li");
      const img = document.createElement("img");
      img.src = chrome.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(t.url)}`) + "&size=32";
      img.width = 16; img.height = 16; img.alt = ""; img.loading = "lazy";
      const a = document.createElement("a");
      a.href = t.url;
      a.textContent = t.title || t.url;
      a.title = t.url;
      a.addEventListener("click", (e) => { e.preventDefault(); send({ type: "restoreTab", url: t.url }); });
      const host = document.createElement("span");
      host.className = "t-host";
      host.textContent = hostOf(t.url);
      li.append(img, a, host);
      ul.appendChild(li);
    }
  }
  details.append(summary, ul);

  const acts = document.createElement("div");
  acts.className = "acts";
  const restore = document.createElement("button");
  restore.className = "primary";
  restore.style.width = "auto";
  restore.style.padding = "6px 14px";
  restore.textContent = "Restore session";
  restore.addEventListener("click", async () => {
    restore.disabled = true;
    const res = await send({ type: "restore", id: s.id });
    restore.disabled = false;
    if (res && res.ok) msg(`Opened ${res.opened} tabs in new windows.`);
  });
  const del = document.createElement("button");
  del.className = "mini danger";
  del.textContent = "Delete";
  del.addEventListener("click", async () => {
    if (!confirm(`Delete "${s.name}"?`)) return;
    await send({ type: "delete", id: s.id });
    boot();
  });
  acts.append(restore, del);

  el.append(top, favRow, details, acts);
  return el;
}

function render() {
  const q = $("#search").value.trim().toLowerCase();
  const cards = $("#cards");
  cards.textContent = "";
  const filtered = state.sessions.filter((s) => {
    if (!q) return true;
    if (s.name.toLowerCase().includes(q)) return true;
    return (s.windows || []).some((w) => (w.tabs || []).some(
      (t) => (t.title || "").toLowerCase().includes(q) || (t.url || "").toLowerCase().includes(q)
    ));
  });
  for (const s of filtered) cards.appendChild(card(s));
  $("#empty").hidden = filtered.length > 0;
  const cap = state.pro ? "∞" : FREE_MAX_SESSIONS;
  $("#usage").textContent = `${state.sessions.length}/${cap} sessions · autosave ${state.settings.auto ? "every " + state.settings.intervalMin + " min" : "off"}`;
}

function fillIntervals() {
  const sel = $("#auto-interval");
  sel.textContent = "";
  const list = state.pro ? PRO_AUTO_INTERVALS : FREE_AUTO_INTERVALS;
  for (const m of list) {
    const o = document.createElement("option");
    o.value = String(m);
    o.textContent = m >= 60 ? `${m / 60} hour${m > 60 ? "s" : ""}` : `${m} min`;
    sel.appendChild(o);
  }
  sel.value = String(state.settings.intervalMin);
  if (![...sel.options].some((o) => o.value === sel.value)) sel.value = String(list[0]);
}

function renderPro() {
  $("#upgrade").hidden = state.pro;
  $("#pro-banner").hidden = !state.pro;
  $("#max-sessions").disabled = !state.pro;
  if (state.pro && state.license && state.license.email) {
    $("#pro-detail").textContent = `Licensed to ${state.license.email}. Unlimited sessions, faster autosave, export/import.`;
  }
  if (!state.pro) {
    $("#buy").hidden = !billingConfigured();
    if (!billingConfigured()) {
      $("#upgrade-copy").textContent +=
        " (Store billing isn't wired up yet — see MONETIZATION.md in the project to connect Gumroad. The free tier below works fully.)";
    }
  }
}

async function boot() {
  const res = await send({ type: "bootstrap" });
  if (!res || !res.ok) return;
  state = { sessions: res.sessions, settings: res.settings, pro: res.pro.pro, license: res.pro.license };
  $("#auto-on").checked = state.settings.auto;
  fillIntervals();
  $("#max-sessions").value = String(state.settings.maxSessions || FREE_MAX_SESSIONS);
  renderPro();
  render();
}

$("#search").addEventListener("input", render);
$("#toggle-settings").addEventListener("click", () => {
  const p = $("#settings-panel");
  p.hidden = !p.hidden;
});
$("#new-stash").addEventListener("click", async () => {
  const res = await send({ type: "stashNow" });
  if (res && res.ok) { msg("Stashed ✓"); boot(); }
  else if (res && res.reason === "limit-reached") msg(`Free plan holds ${res.limit} sessions — upgrade for unlimited.`, true);
  else msg("Nothing restorable to stash right now.", true);
});
$("#save-settings").addEventListener("click", async () => {
  const patch = { auto: $("#auto-on").checked, intervalMin: Number($("#auto-interval").value) };
  if (state.pro) patch.maxSessions = Number($("#max-sessions").value);
  const res = await send({ type: "setSettings", patch });
  if (res && res.ok) { msg("Settings saved ✓"); boot(); }
});
$("#buy").addEventListener("click", () => chrome.tabs.create({ url: buyUrl() }));
$("#activate").addEventListener("click", async () => {
  const key = $("#license-key").value;
  const m = $("#license-msg");
  m.hidden = false;
  m.textContent = "Verifying…";
  m.style.color = "var(--muted)";
  const res = await activateLicense(key);
  m.style.color = res.ok ? "var(--accent)" : "var(--warn)";
  m.textContent = res.ok ? `Activated ✓ ${res.email ? "(" + res.email + ")" : ""}` : res.error;
  if (res.ok) boot();
});
$("#deactivate").addEventListener("click", async () => {
  if (!confirm("Deactivate Pro on this browser?")) return;
  await deactivateLicense();
  boot();
});
$("#export").addEventListener("click", async () => {
  const res = await send({ type: "export" });
  if (!(res && res.ok)) return;
  const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `session-stash-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});
$("#import").addEventListener("click", () => $("#import-file").click());
$("#import-file").addEventListener("change", async (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const res = await send({ type: "import", data });
    if (res && res.ok) { msg(`Imported ${res.added} new sessions ✓`); boot(); }
    else msg("That file isn't a Session Stash export.", true);
  } catch {
    msg("Could not read that file.", true);
  }
  e.target.value = "";
});

boot();
