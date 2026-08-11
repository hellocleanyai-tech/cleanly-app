/**
 * Session, profile, subscription-access and billing logic.
 * Shared by /app and /account so the access rules exist in exactly one place.
 */

import { client } from "./supabase-client.js";
import { CHECKOUTS, PAID_PLANS, checkoutUrlFor } from "./config.js";

/* --------------------------------------------------------------- session -- */

/** True when the current URL looks like an auth provider callback. */
function hasAuthCallbackParams() {
  const search = window.location.search;
  const hash = window.location.hash;
  return (
    search.includes("code=") ||
    search.includes("error=") ||
    hash.includes("access_token=") ||
    hash.includes("error=")
  );
}

/**
 * Wait for Supabase to finish consuming an auth callback from the URL.
 * detectSessionInUrl runs asynchronously, so a naive getSession() immediately
 * after a magic-link redirect can race and bounce the user back to /login.
 */
function waitForSession(timeoutMs = 5000) {
  return new Promise((resolve) => {
    let settled = false;

    const finish = (session) => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      clearTimeout(bail);
      subscription?.unsubscribe();
      resolve(session);
    };

    const { data: { subscription } = {} } = client.auth.onAuthStateChange(
      (_event, session) => {
        if (session) finish(session);
      }
    );

    const poll = setInterval(async () => {
      const { data } = await client.auth.getSession();
      if (data?.session) finish(data.session);
    }, 250);

    const bail = setTimeout(() => finish(null), timeoutMs);
  });
}

/** Strip auth tokens/codes from the address bar after a successful login. */
export function cleanAuthParamsFromUrl() {
  if (!hasAuthCallbackParams()) return;
  window.history.replaceState({}, document.title, window.location.pathname);
}

/**
 * Return the signed-in session, or redirect to /login.
 * @returns {Promise<object|null>} null means a redirect is already underway.
 */
export async function requireSession() {
  const { data } = await client.auth.getSession();
  let session = data?.session || null;

  if (!session && hasAuthCallbackParams()) {
    session = await waitForSession();
  }

  if (!session) {
    const next = window.location.pathname + window.location.search;
    const suffix =
      next && next !== "/app" ? `?next=${encodeURIComponent(next)}` : "";
    window.location.replace(`/login${suffix}`);
    return null;
  }

  cleanAuthParamsFromUrl();
  return session;
}

export async function signOut() {
  await client.auth.signOut();
  window.location.replace("/");
}

/* --------------------------------------------------------------- profile -- */

/**
 * Make sure a profiles row exists for this user, then return it.
 * Mirrors the original upsert (user_id + email, onConflict user_id).
 */
export async function ensureProfile(user) {
  const { error: upsertError } = await client
    .from("profiles")
    .upsert({ user_id: user.id, email: user.email }, { onConflict: "user_id" });

  if (upsertError) {
    console.warn("profile upsert failed:", upsertError.message);
  }

  const { data, error } = await client
    .from("profiles")
    .select(
      "user_id,email,plan,status,trial_used,ls_customer_id,ls_subscription_id,trial_ends_at,current_period_end"
    )
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    console.warn("profile load failed:", error.message);
    return null;
  }

  return data || null;
}

/**
 * Count uploads created since the first day of the current month (UTC).
 * Identical window to the original implementation.
 */
export async function getMonthlyUsage(userId) {
  const startOfMonth = new Date();
  startOfMonth.setUTCDate(1);
  startOfMonth.setUTCHours(0, 0, 0, 0);

  const { count, error } = await client
    .from("uploads")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", startOfMonth.toISOString());

  if (error) {
    console.warn("usage count failed:", error.message);
    return 0;
  }

  return count || 0;
}

/* ---------------------------------------------------------------- access -- */

/**
 * Decide whether the user may use the app.
 *
 * Preserves the original rule exactly: trialing and active always pass, and a
 * cancelled customer on a paid plan keeps access until current_period_end.
 *
 * @param {object|null} profile
 * @returns {{ status: string, plan: string, canUseApp: boolean,
 *             stillWithinPaidPeriod: boolean, isTrialing: boolean,
 *             trialUsed: boolean, periodEnd: Date|null }}
 */
export function evaluateAccess(profile) {
  const status = String(profile?.status || "inactive").toLowerCase();
  const plan = String(profile?.plan || "").toLowerCase();

  const periodEnd = profile?.current_period_end
    ? new Date(profile.current_period_end)
    : null;

  const now = new Date();

  const stillWithinPaidPeriod =
    status === "inactive" &&
    !!periodEnd &&
    !Number.isNaN(periodEnd.getTime()) &&
    periodEnd > now &&
    PAID_PLANS.includes(plan);

  const canUseApp = status === "trialing" || status === "active" || stillWithinPaidPeriod;

  return {
    status,
    plan,
    canUseApp,
    stillWithinPaidPeriod,
    isTrialing: status === "trialing",
    trialUsed: !!profile?.trial_used,
    periodEnd: periodEnd && !Number.isNaN(periodEnd.getTime()) ? periodEnd : null,
  };
}

/* --------------------------------------------------------------- billing -- */

/**
 * Where the Upgrade / Choose a plan button should send this customer.
 *
 * Subscribed customers go straight to the combined Lemon Squeezy checkout,
 * which already presents Starter, Growth and Pro. Customers who have never
 * used the trial get the Starter trial link. Everyone else gets the combined
 * checkout so they can pick any plan.
 */
export function resolveCheckoutUrl(profile, user) {
  const { status, trialUsed } = evaluateAccess(profile);
  const identity = { email: user?.email, userId: user?.id };

  if (status === "active" || status === "trialing") {
    return checkoutUrlFor(CHECKOUTS.checkout, identity);
  }

  if (!trialUsed) {
    return checkoutUrlFor(CHECKOUTS.starterTrial, identity);
  }

  return checkoutUrlFor(CHECKOUTS.checkout, identity);
}

/**
 * Fetch the Lemon Squeezy customer portal URL from the Netlify function.
 * The Lemon Squeezy API key never reaches the browser.
 *
 * @returns {Promise<string>} portal URL
 * @throws {Error} with a message safe to show the customer
 */
export async function fetchBillingPortalUrl(profile) {
  const customerId = profile?.ls_customer_id;

  if (!customerId) {
    throw new Error(
      "Billing portal isn't available yet. It appears once your first payment is processed."
    );
  }

  // The function verifies this token and checks the customer id really
  // belongs to the signed-in user before returning a portal link.
  const { data: sessionData } = await client.auth.getSession();
  const accessToken = sessionData?.session?.access_token;

  if (!accessToken) {
    throw new Error("Your session expired. Sign in again to manage billing.");
  }

  let response;
  try {
    response = await fetch("/.netlify/functions/get-customer-portal", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ customerId }),
    });
  } catch {
    throw new Error("Couldn't reach the billing service. Check your connection and try again.");
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok || !payload?.url) {
    throw new Error(
      payload?.error || "Couldn't open the billing portal. Try again in a moment."
    );
  }

  return payload.url;
}
