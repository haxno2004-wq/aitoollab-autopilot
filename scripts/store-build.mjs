import fs from "node:fs";
import { platformCtx } from "../lib/platform.mjs";
import { buildSite } from "./build.mjs";

/**
 * store-build.mjs — always leaves dist/labstore deployable:
 *   - rebuilds the storefront from the committed product archive, or
 *   - writes a tasteful "opening soon" placeholder if no products exist yet.
 */
const ctx = platformCtx();
const config = ctx.config;

const products = fs.existsSync(ctx.productsDir)
  ? fs.readdirSync(ctx.productsDir).filter((f) => f.endsWith(".json"))
  : [];

if (!products.length) {
  fs.mkdirSync(`${ctx.distDir}`, { recursive: true });
  fs.cpSync("site/assets", `${ctx.distDir}/assets`, { recursive: true });
  fs.writeFileSync(
    `${ctx.distDir}/index.html`,
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${config.site.name}</title><link rel="stylesheet" href="/assets/style.css"></head><body><header class="site-head"><div class="wrap head-wrap"><a class="brand" href="/">⚡ ${config.site.name}</a></div></header><main class="wrap"><section class="hero"><span class="eyebrow">🛍️ opening soon</span><h1>${config.site.name}</h1><p class="dek">${config.site.tagline}</p></section><section><p class="muted-note">Our first products are being crafted by the autonomous pipeline. Check back shortly.</p></section></main><footer class="site-foot"><div class="wrap">© ${new Date().getUTCFullYear()} ${config.site.name}</div></footer></body></html>`
  );
  console.log(`[store-build/${ctx.id}] placeholder storefront (0 products)`);
} else {
  const newest = products
    .map((f) => JSON.parse(fs.readFileSync(`${ctx.productsDir}/${f}`, "utf8")))
    .sort((a, b) => (b._date || "").localeCompare(a._date || ""))[0];
  await buildSite(config, newest, ctx);
}
