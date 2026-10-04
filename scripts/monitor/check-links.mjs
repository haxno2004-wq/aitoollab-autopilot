import fs from "node:fs";
import { allPlatforms } from "../../lib/platform.mjs";

const rows = [];
for (const p of allPlatforms()) {
  const seg = p.type === "store" ? "products" : "posts";
  const base = p.config.site.url.replace(/\/+$/, "");
  rows.push({ platform: p.config.site.name, url: base + "/", title: "homepage" });
  const dir = p.type === "store" ? p.productsDir : p.contentDir;
  try {
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      const j = JSON.parse(fs.readFileSync(`${dir}/${f}`, "utf8"));
      rows.push({
        platform: p.config.site.name,
        url: `${base}/${seg}/${j._slug}.html`,
        title: j.title || j.name,
      });
    }
  } catch {}
}
rows.push({ platform: "DASHBOARD", url: "https://fleetdeck.pages.dev/", title: "Fleet Command Deck" });

let ok = 0;
for (const r of rows) {
  const code = await fetch(r.url, { signal: AbortSignal.timeout(15000) })
    .then((res) => res.status)
    .catch(() => 0);
  if (code === 200) ok++;
  console.log(`${code === 200 ? "✅" : "❌ " + code}  [${r.platform}] ${r.title}`);
  console.log(`        ${r.url}`);
}
console.log(`\n${ok}/${rows.length} URLs live`);
