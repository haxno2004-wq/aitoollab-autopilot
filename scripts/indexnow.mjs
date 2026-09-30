import fs from "node:fs";
import { platformCtx } from "../lib/platform.mjs";

const ctx = platformCtx();
const config = ctx.config;
const built = JSON.parse(fs.readFileSync(`${ctx.stateDir}/.built.json`, "utf8"));

if (!config.indexnow?.enabled || !config.indexnow.key) {
  console.log(`[indexnow/${ctx.id}] disabled or key missing — skipping`);
  process.exit(0);
}

const b = config.site.url.replace(/\/+$/, "");
const host = new URL(b).host;
const seg = config.type === "store" ? "products" : "posts";
const urlList = [`${b}/`, `${b}/${seg}/${built.slug}.html`];
const key = process.env.INDEXNOW_KEY || config.indexnow.key;

const { status } = await fetch("https://api.indexnow.org/indexnow", {
  method: "POST",
  headers: { "content-type": "application/json; charset=utf-8" },
  body: JSON.stringify({ host, key, keyLocation: `${b}/${key}.txt`, urlList }),
  signal: AbortSignal.timeout(20000),
})
  .then((r) => ({ status: r.status }))
  .catch(() => ({ status: 0 }));

if (status === 200 || status === 202) {
  console.log(`[indexnow/${ctx.id}] submitted ${urlList.length} URLs (HTTP ${status})`);
} else {
  console.error(`[indexnow/${ctx.id}] HTTP ${status} — non-fatal; sitemap still discoverable`);
  process.exitCode = 1;
}
