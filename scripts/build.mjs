import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { mdToHtml } from "../lib/markdown.mjs";
import { slugify } from "../lib/state.mjs";

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

function renderPage(body, meta, config) {
  const b = base(config);
  const adsenseScript = config.adsense?.enabled
    ? `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${esc(config.adsense.client)}" crossorigin="anonymous"></script>`
    : "";
  return `<!doctype html>
<html lang="${esc(config.site.language)}">
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
  <meta name="twitter:card" content="summary">
  <link rel="canonical" href="${b}${meta.url}">
  <link rel="alternate" type="application/rss+xml" title="${esc(config.site.name)} RSS" href="${b}/rss.xml">
  <link rel="sitemap" type="application/xml" href="${b}/sitemap.xml">
  <meta name="theme-color" content="#0f1115">
  <link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/assets/style.css">
  <script>(function(){try{var t=localStorage.getItem('theme');if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.setAttribute('data-theme','dark')}catch(e){}})()</script>
</head>
<body>
  <header class="site-head">
    <div class="wrap head-wrap">
      <a class="brand" href="/">⚡ ${esc(config.site.name)}</a>
      <nav><a href="/">Latest</a> <a href="/rss.xml">RSS</a></nav>
    </div>
  </header>
  <main class="wrap">
${body}
  </main>
  <footer class="site-foot">
    <div class="wrap">
      <p>${esc(config.affiliate.disclosure)}</p>
      <p>© ${new Date().getUTCFullYear()} ${esc(config.site.name)} · Generated autonomously · <a href="/rss.xml">RSS</a> · <a href="/sitemap.xml">Sitemap</a></p>
    </div>
  </footer>
  <script src="/assets/site.js" defer></script>
</body>
</html>`;
}

function affiliateBox(config, n = 3) {
  const links = config.affiliate.links;
  // stable pseudo-random pick seeded by week number so the box rotates weekly
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
  <h3>${esc(config.affiliate.slotArticleFootnote.heading)}</h3>
  <ul>
      ${items}
  </ul>
  <p class="aff-note">${esc(config.affiliate.slotArticleFootnote.note)} · ${esc(config.affiliate.disclosure)}</p>
</aside>`;
}

function articleSchema(a, config, url) {
  const b = base(config);
  return {
    "@type": "Article",
    headline: a.title,
    description: a.metaDescription,
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
  const sectionsHtml = (a.sections || [])
    .map((s) => `<section><h2>${esc(s.heading)}</h2>${mdToHtml(s.body || "")}</section>`)
    .join("\n");
  const faqHtml = `<section class="faq"><h2>Frequently asked questions</h2>${(a.faq || [])
    .map((f) => `<details><summary>${esc(f.q)}</summary><div>${mdToHtml(f.a)}</div></details>`)
    .join("\n")}</section>`;

  return `<article>
    <p class="kicker">${(a._date || "").slice(0, 10)} · ${a._wordCount} words · autonomous edition</p>
    <h1>${esc(a.title)}</h1>
    <p class="dek">${esc(a.metaDescription)}</p>
    ${sectionsHtml}
    ${faqHtml}
    <section class="takeaway"><h2>Key takeaway</h2><p><strong>${esc(a.keyTakeaway || "")}</strong></p></section>
    ${affiliateBox(config)}
  </article>`;
}

function articleHtml(a, config) {
  const url = `/posts/${a._slug}.html`;
  const body = articleBodyHtml(a, config);
  const meta = { title: a.title, description: a.metaDescription, url };
  return renderPage(body, meta, config) + "\n" + structuredData(a, config, url);
}

function homePagePostsHtml(posts, config) {
  const items = posts
    .slice(0, 30)
    .map(
      (p) => `<li class="card">
  <a href="/posts/${esc(p.slug)}.html"><h2>${esc(p.title)}</h2></a>
  <p class="dek">${esc(p.description)}</p>
  <p class="meta"><time>${p.date.slice(0, 10)}</time> · ${(p.tags || []).map((t) => `#${esc(t)}`).join(" · ")}</p>
</li>`
    )
    .join("\n");
  return `<section class="hero">
  <h1>${esc(config.site.name)}</h1>
  <p class="dek">${esc(config.site.tagline)}</p>
</section>
<ul class="posts">
${items}
</ul>`;
}

function homeHtml(posts, config) {
  const meta = { title: config.site.name, description: config.site.tagline, url: "/" };
  return renderPage(homePagePostsHtml(posts, config), meta, config);
}

function sitemapXml(posts, config) {
  const b = base(config);
  const urls = [
    { loc: "/", lastmod: posts[0]?.date },
    ...posts.map((p) => ({ loc: `/posts/${p.slug}.html`, lastmod: p.date })),
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

function rssXml(posts, config) {
  const b = base(config);
  const items = posts
    .slice(0, 20)
    .map(
      (p) => `    <item>
      <title>${esc(p.title)}</title>
      <link>${b}/posts/${esc(p.slug)}.html</link>
      <guid isPermaLink="true">${b}/posts/${esc(p.slug)}.html</guid>
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
${items}
</channel></rss>
`;
}

function readContentPosts(contentDir) {
  try {
    return fs
      .readdirSync(contentDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(fs.readFileSync(path.join(contentDir, f), "utf8")))
      .sort((a, b) => (b._date || "").localeCompare(a._date || ""));
  } catch {
    return [];
  }
}

export function buildSite(config, article) {
  const publicDir = "public";
  fs.mkdirSync(publicDir, { recursive: true });

  fs.cpSync("site/assets", path.join(publicDir, "assets"), { recursive: true });

  const contentDir = "content/posts";
  const slug = article._slug || slugify(article.title);
  const dated = { ...article, _date: article._date || new Date().toISOString() };

  // canonical save — the repo (content/posts) is the source of truth, so every
  // run can rebuild the ENTIRE site and old articles never disappear
  fs.mkdirSync(contentDir, { recursive: true });
  fs.writeFileSync(path.join(contentDir, `${slug}.json`), JSON.stringify(dated, null, 2) + "\n");

  // rebuild all article pages from the archive
  const all = readContentPosts(contentDir);
  fs.mkdirSync(path.join(publicDir, "posts"), { recursive: true });
  for (const a of all) {
    const s = a._slug || slugify(a.title);
    fs.writeFileSync(path.join(publicDir, "posts", `${s}.html`), articleHtml(a, config));
  }

  const posts = all.map((a) => ({
    slug: a._slug || slugify(a.title),
    title: a.title,
    description: a.metaDescription,
    date: a._date || new Date(0).toISOString(),
    tags: a.tags || [],
  }));

  fs.writeFileSync(path.join(publicDir, "index.html"), homeHtml(posts, config));
  fs.writeFileSync(path.join(publicDir, "sitemap.xml"), sitemapXml(posts, config));
  fs.writeFileSync(path.join(publicDir, "rss.xml"), rssXml(posts, config));
  fs.writeFileSync(path.join(publicDir, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${base(config)}/sitemap.xml\n`);

  if (config.indexnow?.enabled && config.indexnow.key) {
    fs.writeFileSync(path.join(publicDir, `${config.indexnow.key}.txt`), config.indexnow.key + "\n");
  }

  console.log(`[build] ${slug} published (${dated._wordCount} words, via ${dated._provider}) · rebuilt ${all.length} page(s)`);
  return {
    slug,
    title: dated.title,
    description: dated.metaDescription,
    date: dated._date,
    words: dated._wordCount,
    provider: dated._provider,
  };
}

// CLI (only when executed directly, not when imported by dryrun.mjs)
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) try {
  const config = JSON.parse(fs.readFileSync("config.json", "utf8"));
  const gen = JSON.parse(fs.readFileSync("scripts/.generate.json", "utf8"));
  const entry = buildSite(config, gen);
  fs.writeFileSync("scripts/.built.json", JSON.stringify(entry, null, 2));
} catch (err) {
  console.error("[build] FAILED:", err.message);
  process.exit(1);
}
