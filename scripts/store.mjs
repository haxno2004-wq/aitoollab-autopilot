import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { platformCtx } from "../lib/platform.mjs";
import { generateProduct } from "../lib/llm-product.mjs";
import { loadState, slugify, nowIso } from "../lib/state.mjs";

const ctx = platformCtx();
const config = ctx.config;

function shortHash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

async function publishToGumroad(product, buyUrl, log) {
  const token = process.env.GUMROAD_ACCESS_TOKEN;
  if (!token) {
    log("gumroad", "no GUMROAD_ACCESS_TOKEN — product will be listed on storefront with manual checkout");
    return null;
  }
  // Gumroad API v2: create unpublished product so the owner can review & publish
  const body = new URLSearchParams({
    name: product.name,
    price: String(Math.round((product.price || 19) * 100)), // cents
    description: `${product.tagline}\n\n${product.description}`,
    published: config.gumroad?.publish === true ? "true" : "false",
    ...(buyUrl ? {} : {}),
  });
  const res = await fetch("https://api.gumroad.com/v2/products", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(30000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) throw new Error(`gumroad HTTP ${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
  log("gumroad", `product created: ${data.product?.short_url || data.product?.id} (published=${config.gumroad?.publish === true})`);
  return data.product?.short_url || null;
}

export async function runStore() {
  const state = loadState(ctx.stateFile);
  const catalog = config.catalog || [];
  const done = new Set((state.publishedSlugs || []).map((s) => s)); // slugs
  const usedTitles = new Set((state.usedTopics || []).map((t) => t.toLowerCase()));

  const rotateDays = config.store?.rotateDays || 10;
  const nextAllowed = state.lastRun ? new Date(state.lastRun).getTime() + rotateDays * 864e5 : 0;
  if (Date.now() < nextAllowed) {
    const hrs = Math.ceil((nextAllowed - Date.now()) / 36e5);
    console.log(`[store/${ctx.id}] rotation: next product in ~${hrs}h (nothing to do)`);
    return null;
  }

  const next = catalog.find((c) => !usedTitles.has(c.title.toLowerCase()));
  if (!next) {
    console.log(`[store/${ctx.id}] catalog exhausted — refresh config.catalog with new product ideas`);
    return null;
  }

  const log = (event, detail) => console.log(`[store/${ctx.id}] ${event}: ${detail}`);
  const product = await generateProduct(config, next, log);
  const slug = `${slugify(product.name)}-${shortHash(next.title)}`.slice(0, 80);

  let buyUrl = null;
  try {
    buyUrl = await publishToGumroad(product, null, log);
  } catch (err) {
    log("gumroad", `publish failed (non-fatal): ${err.message}`);
  }

  const record = {
    _slug: slug,
    _date: nowIso(),
    name: product.name,
    tagline: product.tagline,
    metaDescription: product.metaDescription || product.tagline,
    description: product.description,
    tags: product.tags || [],
    price: product.price || 19,
    license: product.license || "personal use license",
    includes: product.includes || [],
    sampleItems: product.sampleItems || [],
    items: product.items || [],
    buyUrl,
    catalogTitle: next.title,
    _provider: "gemini",
  };

  fs.mkdirSync(ctx.productsDir, { recursive: true });
  fs.writeFileSync(ctx.productFile(slug), JSON.stringify(record, null, 2) + "\n");

  // track for dedupe + reporting
  if (!state.publishedSlugs.includes(slug)) state.publishedSlugs.push(slug);
  state.usedTopics.push(next.title);
  state.lastRun = nowIso();
  saveState(ctx.stateFile, state);

  const row = [nowIso(), slug, product.name, "gumroad", product.price || 19, "success"];
  fs.mkdirSync(ctx.stateDir, { recursive: true });
  fs.appendFileSync(ctx.logFile, row.map((c) => (/[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c)).join(",") + "\n");

  fs.writeFileSync(`${ctx.stateDir}/.built.json`, JSON.stringify({ slug, title: product.name, description: record.metaDescription, date: record._date, words: null, provider: "gumroad" }, null, 2));
  console.log(`[store/${ctx.id}] created product: ${product.name} ($${record.price})`);
  return record;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  runStore()
    .then((r) => {
      if (!r) process.exit(0); // rotation skip is a clean no-op
    })
    .catch((err) => {
      console.error(`[store/${ctx.id}] FAILED:`, err.message);
      fs.mkdirSync(ctx.stateDir, { recursive: true });
      fs.writeFileSync(`${ctx.stateDir}/.failed.txt`, err.message);
      process.exit(1);
    });
}
