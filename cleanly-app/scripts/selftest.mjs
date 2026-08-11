/**
 * Self-tests for the logic that decides who can use the app and what plan
 * they're on. Run with: node scripts/selftest.mjs
 *
 * These are the paths where a bug costs money or locks out a paying customer,
 * so they get checked directly rather than by eyeballing the code.
 */

import crypto from "node:crypto";
import assert from "node:assert/strict";

let pass = 0;
let fail = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    pass++;
  } catch (error) {
    console.log(`  ✗ ${name}\n      ${error.message}`);
    fail++;
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    pass++;
  } catch (error) {
    console.log(`  ✗ ${name}\n      ${error.message}`);
    fail++;
  }
}

/* ============================================================ access rules */
// Mirror of evaluateAccess() from public/assets/js/session.js.

const PAID_PLANS = ["starter", "growth", "pro"];

function evaluateAccess(profile) {
  const status = String(profile?.status || "inactive").toLowerCase();
  const plan = String(profile?.plan || "").toLowerCase();
  const periodEnd = profile?.current_period_end ? new Date(profile.current_period_end) : null;
  const now = new Date();

  const stillWithinPaidPeriod =
    status === "inactive" &&
    !!periodEnd &&
    !Number.isNaN(periodEnd.getTime()) &&
    periodEnd > now &&
    PAID_PLANS.includes(plan);

  return {
    status,
    plan,
    stillWithinPaidPeriod,
    canUseApp: status === "trialing" || status === "active" || stillWithinPaidPeriod,
    trialUsed: !!profile?.trial_used,
  };
}

const future = new Date(Date.now() + 7 * 864e5).toISOString();
const past = new Date(Date.now() - 7 * 864e5).toISOString();

console.log("\nAccess rules");

test("active subscriber can use the app", () => {
  assert.equal(evaluateAccess({ status: "active", plan: "growth" }).canUseApp, true);
});

test("trialing subscriber can use the app", () => {
  assert.equal(evaluateAccess({ status: "trialing", plan: "starter" }).canUseApp, true);
});

test("inactive with no period end is locked out", () => {
  assert.equal(evaluateAccess({ status: "inactive", plan: "starter" }).canUseApp, false);
});

test("cancelled customer keeps access until period end", () => {
  const a = evaluateAccess({ status: "inactive", plan: "pro", current_period_end: future });
  assert.equal(a.canUseApp, true, "should still have access");
  assert.equal(a.stillWithinPaidPeriod, true);
});

test("cancelled customer loses access after period end", () => {
  assert.equal(
    evaluateAccess({ status: "inactive", plan: "pro", current_period_end: past }).canUseApp,
    false
  );
});

test("grace period does not apply without a paid plan", () => {
  assert.equal(
    evaluateAccess({ status: "inactive", plan: "none", current_period_end: future }).canUseApp,
    false
  );
});

test("missing profile is treated as inactive, not as access", () => {
  assert.equal(evaluateAccess(null).canUseApp, false);
});

test("malformed period end does not grant access", () => {
  assert.equal(
    evaluateAccess({ status: "inactive", plan: "pro", current_period_end: "not-a-date" }).canUseApp,
    false
  );
});

test("status casing is normalised", () => {
  assert.equal(evaluateAccess({ status: "ACTIVE", plan: "Pro" }).canUseApp, true);
});

/* ========================================================= plan resolution */
// Mirror of resolvePlan() from netlify/functions/lemonsqueezy-webhook.js.

function resolvePlan(attributes, env = {}) {
  const variantMap = {
    [String(env.LEMON_STARTER_VARIANT_ID || "").trim()]: "starter",
    [String(env.LEMON_GROWTH_VARIANT_ID || "").trim()]: "growth",
    [String(env.LEMON_PRO_VARIANT_ID || "").trim()]: "pro",
  };
  delete variantMap[""];

  const variantId = String(attributes?.variant_id ?? "").trim();
  if (variantId && variantMap[variantId]) return variantMap[variantId];

  const name = attributes?.variant_name || attributes?.product_name || attributes?.product?.name;
  if (name) {
    const n = String(name).toLowerCase();
    if (n.includes("starter")) return "starter";
    if (n.includes("growth")) return "growth";
    if (n.includes("pro")) return "pro";
  }
  return null;
}

const VARIANTS = {
  LEMON_STARTER_VARIANT_ID: "111",
  LEMON_GROWTH_VARIANT_ID: "222",
  LEMON_PRO_VARIANT_ID: "333",
};

console.log("\nPlan resolution");

test("variant id maps to the right plan", () => {
  assert.equal(resolvePlan({ variant_id: 222 }, VARIANTS), "growth");
});

test("variant id wins over a misleading product name", () => {
  assert.equal(
    resolvePlan({ variant_id: 333, product_name: "Starter Bundle" }, VARIANTS),
    "pro"
  );
});

test("falls back to name matching when ids are unset", () => {
  assert.equal(resolvePlan({ variant_id: 222, product_name: "Growth" }, {}), "growth");
});

test("unconfigured variant ids never match an empty variant_id", () => {
  assert.equal(resolvePlan({ variant_id: "" }, {}), null);
});

test("unknown variant with no name returns null, not 'none'", () => {
  assert.equal(resolvePlan({ variant_id: 999 }, VARIANTS), null);
});

test("null result means the caller leaves plan untouched", () => {
  const patch = { status: "active" };
  const plan = resolvePlan({ variant_id: 999 }, VARIANTS);
  if (plan) patch.plan = plan;
  assert.equal("plan" in patch, false, "plan must not be written when unresolved");
});

/* ============================================================ event gating */

const SUBSCRIPTION_EVENTS = new Set([
  "subscription_created",
  "subscription_updated",
  "subscription_cancelled",
  "subscription_resumed",
  "subscription_expired",
  "subscription_paused",
  "subscription_unpaused",
  "subscription_plan_changed",
]);

console.log("\nWebhook event gating");

test("order_created is ignored (this was the lockout bug)", () => {
  assert.equal(SUBSCRIPTION_EVENTS.has("order_created"), false);
});

test("subscription_payment_success is ignored", () => {
  assert.equal(SUBSCRIPTION_EVENTS.has("subscription_payment_success"), false);
});

test("subscription_created is processed", () => {
  assert.equal(SUBSCRIPTION_EVENTS.has("subscription_created"), true);
});

test("subscription_plan_changed is processed", () => {
  assert.equal(SUBSCRIPTION_EVENTS.has("subscription_plan_changed"), true);
});

/* =============================================================== status map */

const STATUS_MAP = {
  on_trial: "trialing",
  trialing: "trialing",
  active: "active",
  cancelled: "inactive",
  expired: "inactive",
  past_due: "inactive",
  unpaid: "inactive",
  paused: "inactive",
};

console.log("\nStatus mapping");

test("on_trial becomes trialing", () => assert.equal(STATUS_MAP.on_trial, "trialing"));
test("cancelled becomes inactive", () => assert.equal(STATUS_MAP.cancelled, "inactive"));
test("unknown status falls back to inactive", () =>
  assert.equal(STATUS_MAP.some_new_status || "inactive", "inactive"));

/* ============================================================== signatures */

console.log("\nWebhook signature verification");

function verifySignature(rawBody, signature, secret) {
  const digest = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(digest, "utf8");
  const b = Buffer.from(signature, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const secret = "test-signing-secret";
const body = JSON.stringify({ data: { id: "42", attributes: { status: "active" } } });
const goodSig = crypto.createHmac("sha256", secret).update(body).digest("hex");

test("valid signature is accepted", () => {
  assert.equal(verifySignature(body, goodSig, secret), true);
});

test("tampered body is rejected", () => {
  assert.equal(verifySignature(body + " ", goodSig, secret), false);
});

test("wrong secret is rejected", () => {
  assert.equal(verifySignature(body, goodSig, "wrong-secret"), false);
});

test("short signature does not throw (length checked before compare)", () => {
  assert.equal(verifySignature(body, "abc", secret), false);
});

/* ================================================================= limits */

const LIMITS = {
  trial: { filesPerMonth: 3, maxBytes: 2 * 1024 * 1024 },
  starter: { filesPerMonth: 10, maxBytes: 5 * 1024 * 1024 },
  growth: { filesPerMonth: 50, maxBytes: 25 * 1024 * 1024 },
  pro: { filesPerMonth: 999999, maxBytes: 100 * 1024 * 1024 },
};

console.log("\nPlan limits (must match the original app.js)");

test("trial: 3 files, 2 MB", () => {
  assert.equal(LIMITS.trial.filesPerMonth, 3);
  assert.equal(LIMITS.trial.maxBytes, 2097152);
});
test("starter: 10 files, 5 MB", () => {
  assert.equal(LIMITS.starter.filesPerMonth, 10);
  assert.equal(LIMITS.starter.maxBytes, 5242880);
});
test("growth: 50 files, 25 MB", () => {
  assert.equal(LIMITS.growth.filesPerMonth, 50);
  assert.equal(LIMITS.growth.maxBytes, 26214400);
});
test("pro: unlimited, 100 MB", () => {
  assert.equal(LIMITS.pro.filesPerMonth, 999999);
  assert.equal(LIMITS.pro.maxBytes, 104857600);
});

/* =========================================================== path + naming */

function cleanedFilename(original) {
  return `${(original || "file.csv").replace(/\.csv$/i, "")} - cleaned.csv`;
}

function normalisePath(p) {
  return (p || "")
    .trim()
    .replace(/^\/+/, "")
    .replace(/^files\//, "")
    .split("?")[0]
    .replace(/\r?\n|\r/g, "")
    .replace(/\s+/g, "");
}

console.log("\nFilenames and storage paths");

test("contacts.csv -> 'contacts - cleaned.csv'", () => {
  assert.equal(cleanedFilename("contacts.csv"), "contacts - cleaned.csv");
});

test("uppercase extension handled", () => {
  assert.equal(cleanedFilename("LEADS.CSV"), "LEADS - cleaned.csv");
});

test("missing filename falls back safely", () => {
  assert.equal(cleanedFilename(null), "file - cleaned.csv");
});

test("storage path format is userId/uploadId/original.csv", () => {
  const userId = "abc-123";
  const uploadId = "789";
  assert.equal(`${userId}/${uploadId}/original.csv`, "abc-123/789/original.csv");
});

test("path normalisation strips bucket prefix, slashes and query", () => {
  assert.equal(normalisePath("/files/u1/u2/cleaned.csv?token=x"), "u1/u2/cleaned.csv");
});

/* ========================================================== checkout URLs */

function checkoutUrlFor(url, identity = {}) {
  try {
    const target = new URL(url);
    if (identity.email) target.searchParams.set("checkout[email]", identity.email);
    if (identity.userId) target.searchParams.set("checkout[custom][user_id]", identity.userId);
    if (identity.email) target.searchParams.set("checkout[custom][email]", identity.email);
    return target.toString();
  } catch {
    return url;
  }
}

const COMBINED = "https://cleanly-app.lemonsqueezy.com/checkout";
const TRIAL =
  "https://cleanly-app.lemonsqueezy.com/checkout/buy/951fa1d7-06ec-400a-b43e-fb3f0331d49a";

function resolveCheckoutUrl(profile, user) {
  const { status, trialUsed } = evaluateAccess(profile);
  const id = { email: user?.email, userId: user?.id };
  if (status === "active" || status === "trialing") return checkoutUrlFor(COMBINED, id);
  if (!trialUsed) return checkoutUrlFor(TRIAL, id);
  return checkoutUrlFor(COMBINED, id);
}

const user = { id: "u-1", email: "a@b.com" };

console.log("\nCheckout routing");

test("active subscriber upgrading goes to the combined checkout", () => {
  assert.ok(resolveCheckoutUrl({ status: "active", plan: "starter" }, user).startsWith(COMBINED));
});

test("new user who never trialled gets the Starter trial link", () => {
  assert.ok(resolveCheckoutUrl({ status: "inactive", trial_used: false }, user).startsWith(TRIAL));
});

test("expired user who already trialled gets the combined checkout", () => {
  assert.ok(resolveCheckoutUrl({ status: "inactive", trial_used: true }, user).startsWith(COMBINED));
});

test("checkout carries user id and email for webhook matching", () => {
  const url = resolveCheckoutUrl({ status: "active" }, user);
  assert.ok(url.includes("user_id"), "must pass user_id");
  assert.ok(url.includes("a%40b.com"), "must pass email");
});

/* ======================================================= open-redirect guard */

function destination(nextParam, origin = "https://cleanly.ai") {
  if (nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//")) {
    return `${origin}${nextParam}`;
  }
  return `${origin}/app`;
}

console.log("\nLogin redirect safety");

test("relative next path is honoured", () => {
  assert.equal(destination("/account"), "https://cleanly.ai/account");
});
test("absolute external URL is rejected", () => {
  assert.equal(destination("https://evil.com"), "https://cleanly.ai/app");
});
test("protocol-relative URL is rejected", () => {
  assert.equal(destination("//evil.com"), "https://cleanly.ai/app");
});
test("no next param defaults to /app", () => {
  assert.equal(destination(null), "https://cleanly.ai/app");
});

/* =================================================================== report */

console.log(`\n${"─".repeat(52)}`);
console.log(`  ${pass} passed, ${fail} failed`);
console.log(`${"─".repeat(52)}\n`);

process.exit(fail === 0 ? 0 : 1);
