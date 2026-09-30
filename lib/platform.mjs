import fs from "node:fs";

/**
 * platform.mjs — fleet context. Every pipeline script resolves its paths and
 * config through here, so one codebase runs N earning platforms.
 *
 *   PLATFORM=finflow node scripts/generate.mjs
 *   (default when unset: aitoollab — keeps all existing tooling working)
 */
export function platformCtx(idOverride) {
  const id = idOverride || process.env.PLATFORM || "aitoollab";
  const root = `platforms/${id}`;
  const configFile = `${root}/config.json`;
  if (!fs.existsSync(configFile)) {
    throw new Error(`unknown platform '${id}' — no ${configFile}`);
  }
  const config = JSON.parse(fs.readFileSync(configFile, "utf8"));
  return {
    id,
    type: config.type || "content",
    root,
    config,
    contentDir: `content/${id}/posts`,
    contentFile: (slug) => `content/${id}/posts/${slug}.json`,
    productsDir: `content/${id}/products`,
    productFile: (slug) => `content/${id}/products/${slug}.json`,
    stateDir: `state/${id}`,
    stateFile: `state/${id}/state.json`,
    logFile: `state/${id}/log.csv`,
    distDir: `dist/${id}`,
    imageDir: (slug) => `site/shared/img/${slug}`,
  };
}

/** Load every platform config in the fleet. */
export function allPlatforms() {
  const dir = "platforms";
  const ids = fs
    .readdirSync(dir)
    .filter((f) => fs.existsSync(`${dir}/${f}/config.json`));
  return ids.map((id) => platformCtx(id));
}

/** Format used by all state CSVs (same schema across platforms). */
export function csvEscape(s) {
  s = String(s ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
