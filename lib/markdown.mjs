function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inline(md) {
  let s = escapeHtml(md);
  // links [text](url)
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_m, t, u) => `<a href="${u}" rel="noopener nofollow sponsored">${t}</a>`);
  // bold / italic
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  return s;
}

/**
 * mdToHtml — minimal but safe markdown renderer for generated articles.
 * Supports: ## headings, - / 1. lists, > quotes, paragraphs, inline md.
 * @param {string} md
 * @returns {string} HTML body fragment
 */
export function mdToHtml(md) {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let para = [];
  let list = null; // null | 'ul' | 'ol'
  let quote = null;

  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${inline(para.join(" "))}</p>`);
      para = [];
    }
  };
  const flushList = () => {
    if (list) {
      out.push(list === "ul" ? "</ul>" : "</ol>");
      list = null;
    }
  };
  const flushQuote = () => {
    if (quote) {
      out.push(`<blockquote><p>${inline(quote.join(" "))}</p></blockquote>`);
      quote = null;
    }
  };
  const flushAll = () => {
    flushPara();
    flushList();
    flushQuote();
  };

  for (const raw of lines) {
    const line = raw.trim();

    if (!line) {
      flushAll();
      continue;
    }

    const h = line.match(/^(#{2,4})\s+(.*)$/);
    if (h) {
      flushAll();
      const level = h[1].length;
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
      continue;
    }

    const ul = line.match(/^[-*]\s+(.*)$/);
    if (ul) {
      flushPara();
      flushQuote();
      if (list !== "ul") {
        flushList();
        out.push("<ul>");
        list = "ul";
      }
      out.push(`<li>${inline(ul[1])}</li>`);
      continue;
    }

    const ol = line.match(/^\d+\.\s+(.*)$/);
    if (ol) {
      flushPara();
      flushQuote();
      if (list !== "ol") {
        flushList();
        out.push("<ol>");
        list = "ol";
      }
      out.push(`<li>${inline(ol[1])}</li>`);
      continue;
    }

    const bq = line.match(/^>\s?(.*)$/);
    if (bq) {
      flushPara();
      flushList();
      if (!quote) quote = [];
      quote.push(bq[1]);
      continue;
    }

    flushList();
    flushQuote();
    para.push(line);
  }
  flushAll();
  return out.join("\n");
}

/**
 * words — approximate word count of a markdown/HTML string.
 * @param {string} s
 * @returns {number}
 */
export function wordCount(s) {
  return s.replace(/[#>*`\[\]()-]/g, " ").split(/\s+/).filter(Boolean).length;
}
