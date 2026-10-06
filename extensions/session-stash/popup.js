import { fmtDate, hostOf, FREE_MAX_SESSIONS } from "./lib/common.js";

const $ = (sel) => document.querySelector(sel);
const list = $("#list");

function send(msg) {
  return chrome.runtime.sendMessage(msg);
}

function sessionRow(s) {
  const li = document.createElement("li");
  li.className = "session";

  const favRow = document.createElement("div");
  favRow.className = "fav-row";
  const seen = new Set();
  for (const w of s.windows || []) {
    for (const t of (w.tabs || []).slice(0, 10)) {
      const host = hostOf(t.url);
      if (!host || seen.has(host)) continue;
      seen.add(host);
      const img = document.createElement("img");
      img.src = chrome.runtime.getURL(
        `/_favicon/?pageUrl=${encodeURIComponent(new URL(t.url).origin)}&size=32`
      );
      img.width = 16;
      img.height = 16;
      img.alt = "";
      img.loading = "lazy";
      favRow.appendChild(img);
      if (favRow.children.length >= 8) break;
    }
    if (favRow.children.length >= 8) break;
  }

  const meta = document.createElement("div");
  meta.className = "meta";
  const name = document.createElement("div");
  name.className = "name";
  name.textContent = s.name;
  const sub = document.createElement("div");
  sub.className = "sub muted";
  sub.textContent = `${s.tabCount} tabs · ${fmtDate(s.createdAt)}${s.pinned ? " · 📌" : ""}`;
  meta.append(name, sub);

  const restore = document.createElement("button");
  restore.className = "mini";
  restore.textContent = "Restore";
  restore.addEventListener("click", async () => {
    restore.disabled = true;
    await send({ type: "restore", id: s.id });
    window.close();
  });

  li.append(favRow, meta, restore);
  return li;
}

function render(sessions, filter = "") {
  list.textContent = "";
  const q = filter.trim().toLowerCase();
  const shown = sessions
    .filter((s) => {
      if (!q) return true;
      if (s.name.toLowerCase().includes(q)) return true;
      return (s.windows || []).some((w) => (w.tabs || []).some((t) => (t.title || "").toLowerCase().includes(q) || (t.url || "").toLowerCase().includes(q)));
    })
    .slice(0, 12);
  if (!shown.length) {
    const empty = document.createElement("li");
    empty.className = "empty muted";
    empty.textContent = q ? "No matching sessions." : "No sessions yet — stash your tabs!";
    list.appendChild(empty);
    return;
  }
  for (const s of shown) list.appendChild(sessionRow(s));
}

async function boot() {
  const res = await send({ type: "bootstrap" });
  if (!res || !res.ok) return;
  const { sessions, pro } = res;
  const cap = pro.pro ? "∞" : FREE_MAX_SESSIONS;
  $("#usage").textContent = `${sessions.length}/${cap} sessions`;
  render(sessions, $("#search").value);
}

$("#stash").addEventListener("click", async () => {
  const btn = $("#stash");
  btn.disabled = true;
  btn.textContent = "Stashing…";
  const res = await send({ type: "stashNow" });
  const note = $("#stash-note");
  if (res && res.ok) {
    note.hidden = true;
    await boot();
  } else if (res && res.reason === "limit-reached") {
    note.hidden = false;
    note.textContent = `Free plan holds ${res.limit} sessions. Upgrade in Settings for unlimited.`;
  } else if (res && res.reason === "no-restorable-tabs") {
    note.hidden = false;
    note.textContent = "Nothing to stash — open a normal tab first.";
  } else {
    note.hidden = false;
    note.textContent = "Something went wrong — try again.";
  }
  btn.disabled = false;
  btn.innerHTML = "💾&nbsp; Stash current tabs";
});

$("#search").addEventListener("input", async (e) => {
  const res = await send({ type: "bootstrap" });
  if (res && res.ok) render(res.sessions, e.target.value);
});

$("#manage").addEventListener("click", () => chrome.runtime.openOptionsPage());
$("#settings").addEventListener("click", () => chrome.runtime.openOptionsPage());

boot();
