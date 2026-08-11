/**
 * Plan limits, checkout links and plan presentation metadata.
 * Single source of truth for the browser. Mirrors the server-side plan map
 * in netlify/functions/lemonsqueezy-webhook.js.
 */

const ENV = window.__CLEANLY_ENV__ || {};

export const SUPABASE_URL = ENV.SUPABASE_URL;
export const SUPABASE_ANON_KEY = ENV.SUPABASE_ANON_KEY;
export const SUPPORT_EMAIL = ENV.SUPPORT_EMAIL || "support@cleanly.ai";

/** Upload limits per plan. Unchanged from the original app.js. */
export const LIMITS = {
  trial: { filesPerMonth: 3, maxBytes: 2 * 1024 * 1024 },
  starter: { filesPerMonth: 10, maxBytes: 5 * 1024 * 1024 },
  growth: { filesPerMonth: 50, maxBytes: 25 * 1024 * 1024 },
  pro: { filesPerMonth: 999999, maxBytes: 100 * 1024 * 1024 },
};

/**
 * Checkout destinations.
 *
 * `checkout` is the combined Lemon Squeezy checkout that already presents
 * Starter / Growth / Pro, so there is no separate growth/pro entry and no
 * in-app pricing page.
 */
export const CHECKOUTS = {
  starterTrial: ENV.LS_STARTER_TRIAL_URL,
  starterStandard: ENV.LS_STARTER_STANDARD_URL,
  checkout: ENV.LS_CHECKOUT_URL,
};

/** Plans that count as a real paid plan when checking period-end grace. */
export const PAID_PLANS = ["starter", "growth", "pro"];

/** Display metadata for the dashboard plan card. */
export const PLAN_META = {
  starter: { name: "Starter", price: "€7/month", uploads: "10 uploads per month", size: "5 MB max per file" },
  growth: { name: "Growth", price: "€15/month", uploads: "50 uploads per month", size: "25 MB max per file" },
  pro: { name: "Pro", price: "€29/month", uploads: "Unlimited uploads", size: "100 MB max per file" },
};

/**
 * Append the signed-in customer's identity to a Lemon Squeezy checkout URL.
 *
 * This pre-fills the email so the customer cannot accidentally pay with a
 * different address than the one they signed in with, and passes the Supabase
 * user id through as custom data so the webhook can match the subscription to
 * the right profile even if the email does differ.
 *
 * @param {string} url  Base Lemon Squeezy checkout URL.
 * @param {{ email?: string, userId?: string }} identity
 * @returns {string}
 */
export function checkoutUrlFor(url, identity = {}) {
  if (!url) return "#";

  try {
    const target = new URL(url);
    if (identity.email) target.searchParams.set("checkout[email]", identity.email);
    if (identity.userId) {
      target.searchParams.set("checkout[custom][user_id]", identity.userId);
    }
    if (identity.email) {
      target.searchParams.set("checkout[custom][email]", identity.email);
    }
    return target.toString();
  } catch {
    return url;
  }
}
