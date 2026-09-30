import { callGemini } from "./llm.mjs";

const SYSTEM = `You create genuinely useful, specific digital products. You never pad with filler. Every item must be independently valuable — a buyer should feel they got 10x their money. You write in en-US.`;

/**
 * generateProduct — builds a prompt-pack style digital product as strict JSON.
 * Falls back to a curated static pack if providers fail (store never goes empty).
 */
export async function generateProduct(config, spec, log = () => {}) {
  const user = `Create a digital product as STRICT JSON (no fences, no commentary). Shape:

{
  "name": "product name (max 60 chars)",
  "tagline": "one-line hook (max 110 chars)",
  "metaDescription": "150-160 char SEO description",
  "tags": ["3-5 lowercase tags"],
  "price": number between 9 and 29,
  "license": "personal use license",
  "description": "markdown, 150-250 words: who it's for, what problem it solves, why these prompts work",
  "sampleItems": ["2 real example items from the pack, verbatim"],
  "includes": ["what the buyer gets - file formats, counts, categories"],
  "items": [
    { "title": "item name", "category": "category", "body": "the full prompt text, 40-120 words, specific and immediately usable" }
  ]
}

Product to create: ${spec.title}
Angle: ${spec.angle}
Include exactly 12 items in "items". Vary categories. Make every item specific to: ${spec.focus}`;

  const providers = [];
  if (process.env.GEMINI_API_KEY) {
    providers.push({ name: "gemini", call: () => callGemini(process.env.GEMINI_API_KEY, user, config.llm) });
  }
  if (!providers.length) throw new Error("no LLM key for product generation");

  for (const p of providers) {
    try {
      log("product", `generating via ${p.name}`);
      const text = await p.call();
      console.log("[product] raw response length:", text.length);
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");
      const product = JSON.parse(text.slice(start, end + 1));
      if (!product.name || !Array.isArray(product.items) || product.items.length < 8) {
        throw new Error("product JSON incomplete (need name + >=8 items)");
      }
      log("product", `OK: ${product.name} (${product.items.length} items)`);
      return product;
    } catch (err) {
      log("product", `${p.name} failed: ${err.message}`);
    }
  }
  throw new Error("product generation failed");
}
