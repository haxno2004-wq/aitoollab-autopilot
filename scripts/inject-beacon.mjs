#!/usr/bin/env node
// Inject the Cloudflare Web Analytics beacon into built HTML that is missing it.
//
// Why this exists: the RUM tag step (which sets CF_ANALYTICS_TOKEN) runs AFTER
// scripts/build.mjs / scripts/dashboard.mjs in the workflow. build.mjs already
// injects the beacon when the token is present, but by then the env is not yet
// set. This step re-walks the built output once the token is known so every
// deployed page carries the beacon regardless of step order.
//
// Usage: DIST=dist/finflow node scripts/inject-beacon.mjs
// Env:   DIST (required, directory to walk), CF_ANALYTICS_TOKEN (required)

import fs from "node:fs";
import path from "node:path";

const token = String(process.env.CF_ANALYTICS_TOKEN || "").trim();
const dist = String(process.env.DIST || "").trim();

if (!dist) {
  console.error("inject-beacon: DIST is required (e.g. DIST=dist/dashboard)");
  process.exit(1);
}
if (!fs.existsSync(dist)) {
  console.error(`inject-beacon: ${dist} does not exist`);
  process.exit(1);
}

if (!token) {
  console.log(`inject-beacon: no CF_ANALYTICS_TOKEN for ${dist} — nothing to do`);
  process.exit(0);
}

const payload = JSON.stringify({ token }).replace(/'/g, "&#39;");
const beacon = `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='${payload}'></script>`;

let scanned = 0;
let injected = 0;

const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(p);
    } else if (entry.name.endsWith(".html")) {
      scanned++;
      const page = fs.readFileSync(p, "utf8");
      if (!page.includes("cloudflareinsights.com") && page.includes("</body>")) {
        fs.writeFileSync(p, page.replace("</body>", `${beacon}</body>`));
        injected++;
      }
    }
  }
};

walk(dist);
console.log(`inject-beacon: ${dist} — scanned ${scanned} html, injected ${injected}`);
