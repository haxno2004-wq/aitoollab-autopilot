const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * fetchWithRetry — fetch JSON with exponential backoff on 429 / 5xx / network errors.
 * @param {string} url
 * @param {object} options fetch options
 * @param {object} opts { attempts, baseMs, timeoutMs, onRetry }
 * @returns {Promise<{status:number, data:any}>}
 */
export async function fetchWithRetry(url, options = {}, opts = {}) {
  const attempts = opts.attempts ?? 3;
  const baseMs = opts.baseMs ?? 2000;
  const timeoutMs = opts.timeoutMs ?? 90000;
  let lastErr = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`HTTP ${res.status}`);
        lastErr.status = res.status;
        if (attempt < attempts) {
          const delay = baseMs * 2 ** (attempt - 1);
          opts.onRetry?.(res.status, attempt, delay);
          await sleep(delay);
          continue;
        }
        return { status: res.status, data: null };
      }

      const data = await res.json().catch(() => null);
      return { status: res.status, data };
    } catch (err) {
      lastErr = err;
      if (attempt < attempts) {
        const delay = baseMs * 2 ** (attempt - 1);
        opts.onRetry?.(0, attempt, delay);
        await sleep(delay);
        continue;
      }
    }
  }
  const err = lastErr ?? new Error("fetch failed");
  err.status = err.status ?? 0;
  throw err;
}

export { sleep };
