// Session Stash — Gumroad license verification (freemium unlock).
// How it works:
//   1. Create a product on gumroad.com (see MONETIZATION.md) and paste its
//      product id into lib/common.js -> GUMROAD_PRODUCT_ID.
//   2. A buyer pays on Gumroad and receives a license key.
//   3. The user pastes the key in Settings -> "Upgrade". We verify it against
//      the Gumroad API, store the result locally and re-verify every 30 days.

import { GUMROAD_PRODUCT_ID, isPro, setPro, saveLicense, getProState } from "./common.js";

const VERIFY_URL = "https://api.gumroad.com/v2/licenses/verify";
const RECHECK_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function billingConfigured() {
  return typeof GUMROAD_PRODUCT_ID === "string" && GUMROAD_PRODUCT_ID.length > 0;
}

export function buyUrl() {
  // Gumroad product URLs are gumroad.com/l/<permalink>; the product id and
  // permalink usually differ, so MONETIZATION.md keeps both side by side.
  return "https://gumroad.com/l/session-stash-pro";
}

export async function activateLicense(key) {
  if (!billingConfigured()) {
    return { ok: false, error: "Billing is not configured yet. See MONETIZATION.md to connect Gumroad." };
  }
  const trimmed = (key || "").trim();
  if (trimmed.length < 8) return { ok: false, error: "That license key looks too short." };

  let res;
  try {
    res = await fetch(VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        product_id: GUMROAD_PRODUCT_ID,
        license_key: trimmed,
        increment_uses_count: "false",
      }),
    });
  } catch {
    return { ok: false, error: "Could not reach Gumroad — check your connection and try again." };
  }

  let data;
  try {
    data = await res.json();
  } catch {
    return { ok: false, error: "Unexpected response from Gumroad." };
  }

  if (!res.ok || !data || data.success !== true) {
    return { ok: false, error: (data && data.message) || "That license key was not recognized." };
  }

  const purchase = data.purchase || {};
  if (purchase.refunded || purchase.chargebacked || purchase.subscription_cancelled_at) {
    return { ok: false, error: "That license was refunded or cancelled." };
  }

  await saveLicense({
    key: trimmed,
    email: purchase.email || null,
    verifiedAt: Date.now(),
    uses: purchase.uses || 1,
  });
  await setPro(true);
  return { ok: true, email: purchase.email || null };
}

export async function refreshLicenseIfStale() {
  const { pro, license } = await getProState();
  if (!pro || !license || !billingConfigured()) return { pro };
  if (Date.now() - (license.verifiedAt || 0) < RECHECK_MS) return { pro };

  try {
    const res = await fetch(VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        product_id: GUMROAD_PRODUCT_ID,
        license_key: license.key,
        increment_uses_count: "false",
      }),
    });
    const data = await res.json();
    const purchase = (data && data.purchase) || {};
    const valid =
      res.ok && data.success === true && !purchase.refunded && !purchase.chargebacked;
    if (valid) {
      await saveLicense({ ...license, verifiedAt: Date.now() });
    } else {
      await setPro(false);
      return { pro: false, downgraded: true };
    }
  } catch {
    // Network hiccup — keep pro active, retry next scheduled check.
  }
  return { pro: await isPro() };
}

export async function deactivateLicense() {
  await setPro(false);
  await saveLicense(null);
  return { ok: true };
}
