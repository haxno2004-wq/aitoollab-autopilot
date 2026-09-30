import fs from "node:fs";
import { fetchWithRetry } from "../lib/http.mjs";

const config = JSON.parse(fs.readFileSync("config.json", "utf8"));
const built = JSON.parse(fs.readFileSync("scripts/.built.json", "utf8"));

if (!config.indexnow?.enabled || !config.indexnow.key) {
  console.log("[indexnow] disabled or key missing — skipping (set config.indexnow.key + secret INDEXNOW_KEY)");
  process.exit(0);
}

const b = config.site.url.replace(/\/+$/, "");
const host = new URL(b).host;
const urlList = [`${b}/`, `${b}/posts/${built.slug}.html`];
const key = process.env.INDEXNOW_KEY || config.indexnow.key;

const { status } = await fetchWithRetry(
  "https://api.indexnow.org/indexnow",
  {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ host, key, keyLocation: `${b}/${key}.txt`, urlList }),
  },
  { attempts: 2, baseMs: 2000, timeoutMs: 20000 }
);

if (status === 200 || status === 202) {
  console.log(`[indexnow] submitted ${urlList.length} URLs (HTTP ${status})`);
} else {
  console.error(`[indexnow] HTTP ${status} — non-fatal; URLs remain discoverable via sitemap.xml`);
  process.exitCode = 1; // workflow step is continue-on-error
}
