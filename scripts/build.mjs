import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { mdToHtml } from "../lib/markdown.mjs";
import { slugify } from "../lib/state.mjs";
import { platformCtx } from "../lib/platform.mjs";

const ctx = platformCtx();

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function base(config) {
  return config.site.url.replace(/\/+$/, "");
}

const FLEET_LINKS = [
  ["AI ToolLab", "https://aitoollab.pages.dev"],
  ["MoneyPilot", "https://moneypilot.pages.dev"],
  ["DevToolkit Daily", "https://devtoolkit-daily.pages.dev"],
  ["PromptForge Shop", "https://promptforge-shop.pages.dev"],
];

// cross-links to the other fleet sites (omits this site)
function fleetLinksHtml(config) {
  const own = base(config).replace(/^https:\/\//, "");
  return FLEET_LINKS
    .filter(([, u]) => !u.includes(own))
    .map(([n, u]) => `<li><a href="${u}" target="_blank" rel="noopener">${n}</a></li>`)
    .join("\n          ");
}

// About/Privacy pages carry their own <head>, so accent vars go inline there
function accentStyle(config) {
  const th = config.theme || {};
  return `<style>:root{--accent:${th.accent || "#6d5cff"};--accent2:${th.accent2 || "#00c2a8"};--accent3:${th.accent3 || "#ff5c8a"}}</style>`;
}

const readingTime = (words) => `${Math.max(1, Math.round((words || 900) / 220))} min read`;

// ---------- AI hero images (free, keyless; never blocks a build) ----------

function imagePromptFor(title, tags) {
  const kw = (tags || []).slice(0, 2).join(", ");
  return `modern editorial illustration about ${String(title).slice(0, 80)}. ${kw}. futuristic, clean, vibrant gradient lighting, glassmorphism, high detail, no text`;
}

function svgFallback(slug) {
  const hue = [...slug].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600" viewBox="0 0 1200 600"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},80%,60%)"/><stop offset="1" stop-color="hsl(${(hue + 70) % 360},80%,45%)"/></linearGradient></defs><rect width="1200" height="600" fill="url(#g)"/><circle cx="950" cy="140" r="220" fill="rgba(255,255,255,0.14)"/><circle cx="240" cy="480" r="300" fill="rgba(0,0,0,0.10)"/><text x="60" y="330" font-family="Segoe UI,Arial" font-size="64" font-weight="800" fill="rgba(255,255,255,0.92)">${esc(ctx.config.site.name)}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function detectImage(buf) {
  if (buf.length < 12) return null;
  const h = buf.subarray(0, 4).toString("hex");
  if (h.startsWith("ffd8")) return "jpg";
  if (h.startsWith("89504e47")) return "png";
  if (h === "52494646" && buf.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  return null;
}

async function generateImageFor(title, tags, slug, imagesDir) {
  for (const ext of ["jpg", "png", "webp"]) {
    const f = path.join(imagesDir, `${slug}.${ext}`);
    if (fs.existsSync(f) && fs.statSync(f).size > 3000) return `/assets/img/${slug}.${ext}`;
  }
  const prompt = encodeURIComponent(imagePromptFor(title, tags));
  const providers = [
    { url: `https://image.pollinations.ai/prompt/${prompt}?width=1200&height=600&nologo=true&seed=${slug.length}`, name: "pollinations" },
    { url: `https://api.a0.dev/assets/image?text=${prompt}&aspect=16:9&seed=${(slug.charCodeAt(0) || 7) * 13}`, name: "a0" },
  ];
  for (const p of providers) {
    try {
      const res = await fetch(p.url, { signal: AbortSignal.timeout(60000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const ext = detectImage(buf);
      if (!ext || buf.length < 3000) throw new Error(`invalid image (${buf.length}b)`);
      fs.writeFileSync(path.join(imagesDir, `${slug}.${ext}`), buf);
      console.log(`[img/${ctx.id}] ${slug} ← ${p.name} (${Math.round(buf.length / 1024)}kb ${ext})`);
      return `/assets/img/${slug}.${ext}`;
    } catch (err) {
      console.error(`[img/${ctx.id}] ${p.name} failed for ${slug}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  console.error(`[img/${ctx.id}] fallback SVG for ${slug} (will retry next run)`);
  return svgFallback(slug);
}

// ---------- rendering ----------

function renderPage(body, meta, config) {
  const b = base(config);
  const th = config.theme || {};
  const accent = th.accent || "#6d5cff";
  const accent2 = th.accent2 || "#00c2a8";
  const accent3 = th.accent3 || "#ff5c8a";
  const adsenseScript = config.adsense?.enabled
    ? `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${esc(config.adsense.client)}" crossorigin="anonymous"></script>`
    : "";
  return `<!doctype html>
<html lang="${esc(config.site.language)}" class="no-js" data-skin="${esc(config.skin || "editorial")}" data-default-theme="${esc(config.defaultTheme || "light")}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(meta.title)} — ${esc(config.site.name)}</title>
  <meta name="description" content="${esc(meta.description)}">
  ${adsenseScript}
  <meta property="og:title" content="${esc(meta.title)} — ${esc(config.site.name)}">
  <meta property="og:description" content="${esc(meta.description)}">
  <meta property="og:type" content="article">
  <meta property="og:url" content="${b}${meta.url}">
  ${meta.image ? `<meta property="og:image" content="${esc(meta.image)}">\n  <meta name="twitter:card" content="summary_large_image">\n  <meta name="twitter:image" content="${esc(meta.image)}">` : '<meta name="twitter:card" content="summary">'}
  <link rel="canonical" href="${b}${meta.url}">
  <link rel="alternate" type="application/rss+xml" title="${esc(config.site.name)} RSS" href="${b}/rss.xml">
  <link rel="sitemap" type="application/xml" href="${b}/sitemap.xml">
  <meta name="theme-color" content="${esc(th.bgDark || "#0a0c14")}">
  <link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
  <style>
    :root { --accent:${accent}; --accent2:${accent2}; --accent3:${accent3}; }
  </style>
  <link rel="stylesheet" href="/assets/style.css?v=2">
  <script>(function(){try{var d=document.documentElement.getAttribute('data-default-theme')==='dark';var t=localStorage.getItem('theme');if(t==='dark'||(d&&!t)||(!t&&!d&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.setAttribute('data-theme','dark')}catch(e){}})()</script>
</head>
<body>
  <header class="site-head">
    <div class="wrap head-wrap">
      <a class="brand" href="/">⚡ ${esc(config.site.name)}</a>
      <nav>
        <a href="/">Latest</a>
        <a href="/about.html">About</a>
        <a href="/privacy.html">Privacy</a>
        <a href="/rss.xml">RSS</a>
        <span class="currency-widget"><span class="currency-symbol">$</span><select id="currency-select" class="currency-select" aria-label="Currency"></select></span>
      </nav>
    </div>
  </header>
  <main class="wrap">
${body}
  </main>
  <footer class="site-foot">
    <div class="wrap foot-grid">
      <div>
        <h4>${esc(config.site.name)}</h4>
        <p class="foot-blurb">${esc(config.site.tagline)}</p>
      </div>
      <div>
        <h4>Explore</h4>
        <ul>
          <li><a href="/">Latest</a></li>
          <li><a href="/rss.xml">RSS feed</a></li>
          <li><a href="/sitemap.xml">Sitemap</a></li>
        </ul>
      </div>
      <div>
        <h4>Company</h4>
        <ul>
          <li><a href="/about.html">About us</a></li>
          <li><a href="/privacy.html">Privacy policy</a></li>
        </ul>
      </div>
      <div>
        <h4>The fleet</h4>
        <ul>
          ${fleetLinksHtml(config)}
        </ul>
      </div>
    </div>
    <div class="wrap foot-legal">
      <p>${esc(config.affiliate?.disclosure || "")}</p>
      <p>© ${new Date().getUTCFullYear()} ${esc(config.site.name)} · Generated autonomously</p>
    </div>
  </footer>
  <script src="/assets/site.js?v=2" defer></script>
  <script src="/assets/fx.js?v=2" defer></script>
</body>
</html>`;
}

function affiliateBox(config, n = 3) {
  const links = config.affiliate?.links || [];
  if (!links.length) return "";
  const seed = Math.floor(Date.now() / 6048e5);
  const used = new Set();
  const picks = [];
  let x = seed % links.length;
  for (let i = 0; i < Math.min(n, links.length); i++) {
    while (used.has(x)) x = (x + 1) % links.length;
    used.add(x);
    picks.push(links[x]);
  }
  const items = picks
    .map((l) => `<li><a href="${esc(l.url)}" rel="sponsored noopener" target="_blank">${esc(l.label)}</a><span class="why"> — ${esc(l.context)}</span></li>`)
    .join("\n      ");
  return `<aside class="aff-box">
  <h3>${esc(config.affiliate.slotArticleFootnote?.heading || "Tools worth trying")}</h3>
  <ul>
      ${items}
  </ul>
  <p class="aff-note">${esc(config.affiliate.slotArticleFootnote?.note || "Editorial picks.")} · ${esc(config.affiliate.disclosure)}</p>
</aside>`;
}

function articleSchema(a, config, url) {
  const b = base(config);
  return {
    "@type": "Article",
    headline: a.title,
    description: a.metaDescription,
    ...(a._image && !a._image.startsWith("data:") ? { image: `${b}${a._image}` } : {}),
    datePublished: a._date,
    dateModified: a._date,
    keywords: (a.tags || []).join(", "),
    author: { "@type": "Organization", name: config.site.author },
    publisher: { "@type": "Organization", name: config.site.name },
    mainEntityOfPage: `${b}${url}`,
  };
}

function faqSchema(a) {
  return {
    "@type": "FAQPage",
    mainEntity: (a.faq || []).map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
}

function structuredData(a, config, url) {
  const graph = [articleSchema(a, config, url)];
  if ((a.faq || []).length) graph.push(faqSchema(a));
  return `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@graph": graph })}</script>`;
}

function articleBodyHtml(a, config) {
  const heroImg = a._image
    ? `<img class="hero-img" src="${esc(a._image)}" alt="AI-generated illustration for: ${esc(a.title)}" width="1200" height="600" loading="eager">`
    : "";
  const sectionsHtml = (a.sections || [])
    .map((s) => `<section><h2>${esc(s.heading)}</h2>${mdToHtml(s.body || "")}</section>`)
    .join("\n");
  const faqHtml = `<section class="faq"><h2>Frequently asked questions</h2>${(a.faq || [])
    .map((f) => `<details><summary>${esc(f.q)}</summary><div>${mdToHtml(f.a)}</div></details>`)
    .join("\n")}</section>`;

  return `<article>
    <p class="kicker">${(a._date || "").slice(0, 10)} · <span class="reading-time">${readingTime(a._wordCount)}</span> · ${a._wordCount} words · autonomous edition</p>
    <h1>${esc(a.title)}</h1>
    <p class="dek">${esc(a.metaDescription)}</p>
    ${heroImg}
    ${sectionsHtml}
    ${faqHtml}
    <section class="takeaway"><h2>Key takeaway</h2><p><strong>${esc(a.keyTakeaway || "")}</strong></p></section>
    ${affiliateBox(config)}
  </article>`;
}

function articleHtml(a, config) {
  const url = `/posts/${a._slug}.html`;
  const body = articleBodyHtml(a, config);
  const meta = { title: a.title, description: a.metaDescription, url, image: a._image };
  return renderPage(body, meta, config) + "\n" + structuredData(a, config, url);
}

// ---------- store product pages ----------

function productBodyHtml(p, config) {
  const img = p._image
    ? `<img class="hero-img" src="${esc(p._image)}" alt="Preview art for ${esc(p.name)}" width="1200" height="600">`
    : "";
  const includesHtml = (p.includes || [])
    .map((i) => `<li>${esc(i)}</li>`)
    .join("\n");
  const cta = p.buyUrl
    ? `<a class="buy-btn" href="${esc(p.buyUrl)}" rel="noopener nofollow sponsored" target="_blank">Get it on Gumroad — <span data-usd="${esc(p.price)}">$${esc(p.price)}</span></a>`
    : `<p class="muted-note">Checkout link pending — set <code>buyUrl</code> in the product JSON.</p>`;
  const sampleHtml = p.sampleItems?.length
    ? `<section><h2>What's inside (sample)</h2><ul>${p.sampleItems.map((s) => `<li>${esc(s)}</li>`).join("")}</ul></section>`
    : "";

  return `<article class="product">
    <p class="kicker">digital product · instant download</p>
    <h1>${esc(p.name)}</h1>
    <p class="dek">${esc(p.tagline)}</p>
    ${img}
    <section><h2>What this is</h2>${mdToHtml(p.description)}</section>
    ${sampleHtml}
    <section><h2>Included</h2><ul class="includes">${includesHtml}</ul></section>
    <section class="takeaway"><h2>Price</h2><p class="price-line"><strong data-usd="${esc(p.price)}">$${esc(p.price)}</strong> · ${esc(p.license || "personal use license")}</p><p>${cta}</p></section>
  </article>`;
}

function productHtml(p, config) {
  const url = `/products/${p._slug}.html`;
  const body = productBodyHtml(p, config);
  const meta = { title: p.name, description: p.tagline, url, image: p._image };
  return renderPage(body, meta, config) + `\n<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Product",
    name: p.name,
    description: p.description,
    offers: { "@type": "Offer", price: p.price, priceCurrency: "USD", availability: "https://schema.org/InStock", url: `${base(config)}${url}` },
  })}</script>`;
}

// ---------- index / home per type ----------

function homeHtml(items, config) {
  const isStore = (config.type || "content") === "store";
  const cardItems = items
    .slice(0, 30)
    .map((p) => {
      const href = isStore ? `/products/${p.slug}.html` : `/posts/${p.slug}.html`;
      return `<li class="card">
  <a class="thumb" href="${href}">${p.image ? `<img src="${esc(p.image)}" alt="Illustration for: ${esc(p.title)}" loading="lazy" width="640" height="280">` : ""}</a>
  <div class="card-body">
  <a href="${href}"><h2>${esc(p.title)}</h2></a>
  <p class="dek">${esc(p.description)}</p>
  <p class="meta">${isStore && p.price ? `<span class="tag price-tag" data-usd="${esc(p.price)}">$${esc(p.price)}</span> · ` : ""}<time>${p.date.slice(0, 10)}</time>${p.tags?.length ? " · " + p.tags.map((t) => `<span class="tag">#${esc(t)}</span>`).join(" ") : ""}</p>
  </div>
</li>`;
    })
    .join("\n");
  const eyebrow = isStore ? "🛍️ Fresh digital products, added automatically" : "⚡ Updated by an autonomous agent";
  const body = `<section class="hero">
  <span class="eyebrow">${eyebrow}</span>
  <h1>${esc(config.site.name)}</h1>
  <p class="dek">${esc(config.site.tagline)}</p>
</section>
<ul class="posts">
${cardItems}
</ul>`;
  return renderPage(body, { title: config.site.name, description: config.site.tagline, url: "/" }, config);
}

function sitemapXml(items, config, kind) {
  const b = base(config);
  const seg = kind === "store" ? "products" : "posts";
  const urls = [
    { loc: "/", lastmod: items[0]?.date },
    ...items.map((p) => ({ loc: `/${seg}/${p.slug}.html`, lastmod: p.date })),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) =>
      `  <url><loc>${b}${u.loc}</loc><lastmod>${(u.lastmod || new Date().toISOString()).slice(0, 10)}</lastmod></url>`
  )
  .join("\n")}
</urlset>
`;
}

function rssXml(items, config, kind) {
  const b = base(config);
  const seg = kind === "store" ? "products" : "posts";
  const body = items
    .slice(0, 20)
    .map(
      (p) => `    <item>
      <title>${esc(p.title)}</title>
      <link>${b}/${seg}/${esc(p.slug)}.html</link>
      <guid isPermaLink="true">${b}/${seg}/${esc(p.slug)}.html</guid>
      <pubDate>${new Date(p.date).toUTCString()}</pubDate>
      <description>${esc(p.description)}</description>
    </item>`
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
    <title>${esc(config.site.name)}</title>
    <link>${b}/</link>
    <description>${esc(config.site.tagline)}</description>
${body}
</channel></rss>
`;
}

// ---------- main build ----------

function readArchive(archiveDir) {
  try {
    return fs
      .readdirSync(archiveDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(fs.readFileSync(path.join(archiveDir, f), "utf8")))
      .sort((a, b) => (b._date || "").localeCompare(a._date || ""));
  } catch {
    return [];
  }
}

export async function buildSite(config, newItem, ctxOverride) {
  const C = ctxOverride || ctx;
  const publicDir = C.distDir;
  const isStore = (config.type || "content") === "store";
  fs.mkdirSync(publicDir, { recursive: true });

  fs.cpSync("site/assets", path.join(publicDir, "assets"), { recursive: true });
  if (fs.existsSync("site/shared")) fs.cpSync("site/shared", path.join(publicDir, "shared"), { recursive: true });

  const archiveDir = isStore ? C.productsDir : C.contentDir;
  const item = { ...newItem, _date: newItem._date || new Date().toISOString() };
  const slug = item._slug || item.slug || slugify(item.title || item.name);
  item._slug = slug; // normalize so archive file, pages and sitemap always agree
  fs.mkdirSync(archiveDir, { recursive: true });
  fs.writeFileSync(path.join(archiveDir, `${slug}.json`), JSON.stringify(item, null, 2) + "\n");

  const all = readArchive(archiveDir);

  // images (shared across platforms via site/shared/img)
  const imagesDir = "site/shared/img";
  fs.mkdirSync(imagesDir, { recursive: true });
  const b = base(config);
  for (const a of all) {
    const s = a._slug || slugify(a.title || a.name);
    const local = await generateImageFor(a.title || a.name, a.tags, s, imagesDir);
    a._image = local.startsWith("data:") ? local : `${b}${local}`;
  }
  fs.cpSync(imagesDir, path.join(publicDir, "assets", "img"), { recursive: true });
  fs.copyFileSync("site/assets/fx.js", path.join(publicDir, "assets", "fx.js"));

  const seg = isStore ? "products" : "posts";
  fs.mkdirSync(path.join(publicDir, seg), { recursive: true });
  for (const a of all) {
    const s = a._slug || slugify(a.title || a.name);
    fs.writeFileSync(path.join(publicDir, seg, `${s}.html`), isStore ? productHtml(a, config) : articleHtml(a, config));
  }

  const listItems = all.map((a) => ({
    slug: a._slug || slugify(a.title || a.name),
    title: a.title || a.name,
    description: a.metaDescription || a.tagline,
    date: a._date || new Date(0).toISOString(),
    tags: a.tags || [],
    image: a._image,
    price: a.price,
  }));

  fs.writeFileSync(path.join(publicDir, "index.html"), homeHtml(listItems, config));

  // About + Privacy — required for AdSense approval and user trust
  const about = `<!doctype html>
<html lang="${esc(config.site.language)}" class="no-js" data-skin="${esc(config.skin || "editorial")}" data-default-theme="${esc(config.defaultTheme || "light")}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>About — ${esc(config.site.name)}</title><meta name="description" content="About ${esc(config.site.name)}: what we publish and how it's made.">
<link rel="canonical" href="${b}/about.html"><link rel="stylesheet" href="/assets/style.css?v=2">${accentStyle(config)}
<script>(function(){try{var d=document.documentElement.getAttribute('data-default-theme')==='dark';var t=localStorage.getItem('theme');if(t==='dark'||(d&&!t)||(!t&&!d&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.setAttribute('data-theme','dark')}catch(e){}})()</script></head>
<body><header class="site-head"><div class="wrap head-wrap"><a class="brand" href="/">⚡ ${esc(config.site.name)}</a><nav><a href="/">Latest</a><a href="/privacy.html">Privacy</a><a href="/rss.xml">RSS</a><span class="currency-widget"><span class="currency-symbol">$</span><select id="currency-select" class="currency-select" aria-label="Currency"></select></span></nav></div></header>
<main class="wrap"><article><h1>About ${esc(config.site.name)}</h1>
<p>${esc(config.site.tagline)}</p>
<section><h2>How this site is made</h2>
<p>${esc(config.site.name)} is an autonomous publication: an automated editorial pipeline monitors public sources (news aggregators, open-source communities, public forums), selects topics our readers ask about, drafts articles with AI models, and passes every piece through a quality gate before publication. Our editorial standards: no invented statistics, no fake claims, hedged language where certainty ends. Prices and product details are verified at publication time and can change — always confirm on the vendor's site.</p>
<p>Some links are affiliate links, marked per our disclosure: if you buy through them we may earn a commission at no extra cost to you. This never influences our verdicts — negative reviews stay negative.</p>
</section>
<section><h2>Contact</h2><p>Questions, corrections, or partnership requests: open an issue on our <a href="https://github.com/haxno2004-wq/aitoollab-autopilot">public repository</a>.</p></section>
</article></main><footer class="site-foot"><div class="wrap foot-grid"><div><h4>${esc(config.site.name)}</h4><p class="foot-blurb">${esc(config.site.tagline)}</p></div><div><h4>Explore</h4><ul><li><a href="/">Latest</a></li><li><a href="/rss.xml">RSS feed</a></li><li><a href="/sitemap.xml">Sitemap</a></li></ul></div><div><h4>Company</h4><ul><li><a href="/about.html">About us</a></li><li><a href="/privacy.html">Privacy policy</a></li></ul></div><div><h4>The fleet</h4><ul>${fleetLinksHtml(config)}</ul></div></div><div class="wrap foot-legal"><p>© ${new Date().getUTCFullYear()} ${esc(config.site.name)} · Generated autonomously</p></div></footer>
<script src="/assets/site.js?v=2" defer></script><script src="/assets/fx.js?v=2" defer></script></body></html>`;
  fs.writeFileSync(path.join(publicDir, "about.html"), about);

  const privacy = `<!doctype html>
<html lang="${esc(config.site.language)}" class="no-js" data-skin="${esc(config.skin || "editorial")}" data-default-theme="${esc(config.defaultTheme || "light")}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Privacy Policy — ${esc(config.site.name)}</title><meta name="description" content="Privacy policy for ${esc(config.site.name)}.">
<link rel="canonical" href="${b}/privacy.html"><link rel="stylesheet" href="/assets/style.css?v=2">${accentStyle(config)}
<script>(function(){try{var d=document.documentElement.getAttribute('data-default-theme')==='dark';var t=localStorage.getItem('theme');if(t==='dark'||(d&&!t)||(!t&&!d&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.setAttribute('data-theme','dark')}catch(e){}})()</script></head>
<body><header class="site-head"><div class="wrap head-wrap"><a class="brand" href="/">⚡ ${esc(config.site.name)}</a><nav><a href="/">Latest</a><a href="/about.html">About</a><a href="/rss.xml">RSS</a><span class="currency-widget"><span class="currency-symbol">$</span><select id="currency-select" class="currency-select" aria-label="Currency"></select></span></nav></div></header>
<main class="wrap"><article><h1>Privacy Policy</h1>
<p>Last updated: ${new Date().toISOString().slice(0, 10)}</p>
<section><h2>What we collect</h2><p>This site runs no first-party analytics and stores no personal data on our servers. Your theme and currency preferences are saved only in your own browser (localStorage) and never leave your device.</p></section>
<section><h2>Third parties</h2><p>If advertising is enabled, Google AdSense may set cookies to personalize ads. You can opt out via <a href="https://adssettings.google.com" rel="noopener">Google Ads Settings</a>. Affiliate partners may track referral clicks through their own links, governed by their privacy policies. Product checkout (if enabled) is processed by third parties (e.g. Gumroad) — we never see your payment details.</p></section>
<section><h2>Your choices</h2><p>You can clear stored preferences any time via your browser settings. For privacy questions, open an issue on our <a href="https://github.com/haxno2004-wq/aitoollab-autopilot">public repository</a>.</p></section>
</article></main><footer class="site-foot"><div class="wrap foot-grid"><div><h4>${esc(config.site.name)}</h4><p class="foot-blurb">${esc(config.site.tagline)}</p></div><div><h4>Explore</h4><ul><li><a href="/">Latest</a></li><li><a href="/rss.xml">RSS feed</a></li><li><a href="/sitemap.xml">Sitemap</a></li></ul></div><div><h4>Company</h4><ul><li><a href="/about.html">About us</a></li><li><a href="/privacy.html">Privacy policy</a></li></ul></div><div><h4>The fleet</h4><ul>${fleetLinksHtml(config)}</ul></div></div><div class="wrap foot-legal"><p>© ${new Date().getUTCFullYear()} ${esc(config.site.name)} · Generated autonomously</p></div></footer>
<script src="/assets/site.js?v=2" defer></script><script src="/assets/fx.js?v=2" defer></script></body></html>`;
  fs.writeFileSync(path.join(publicDir, "privacy.html"), privacy);

  fs.writeFileSync(path.join(publicDir, "sitemap.xml"), sitemapXml(listItems, config, config.type));
  fs.writeFileSync(path.join(publicDir, "rss.xml"), rssXml(listItems, config, config.type));
  fs.writeFileSync(path.join(publicDir, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${b}/sitemap.xml\n`);

  if (config.indexnow?.enabled && config.indexnow.key) {
    fs.writeFileSync(path.join(publicDir, `${config.indexnow.key}.txt`), config.indexnow.key + "\n");
  }

  const published = all.length;
  console.log(`[build/${C.id}] ${slug} published (${item._wordCount || "product"}) · ${published} item(s) live`);
  return {
    slug,
    title: item.title || item.name,
    description: item.metaDescription || item.tagline,
    date: item._date,
    words: item._wordCount,
    provider: item._provider,
  };
}

// CLI
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  try {
    const genFile = `${ctx.stateDir}/.generate.json`;
    const gen = JSON.parse(fs.readFileSync(genFile, "utf8"));
    const entry = await buildSite(ctx.config, gen, ctx);
    fs.writeFileSync(`${ctx.stateDir}/.built.json`, JSON.stringify(entry, null, 2));
  } catch (err) {
    console.error(`[build/${ctx.id}] FAILED:`, err.message);
    process.exit(1);
  }
}
