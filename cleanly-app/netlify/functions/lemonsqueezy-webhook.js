/**
 * POST /.netlify/functions/lemonsqueezy-webhook
 *
 * Verifies Lemon Squeezy webhooks and syncs subscription state into the
 * Supabase `profiles` table using the service role key.
 *
 * Changes from the original, all aimed at not corrupting billing state:
 *
 *  1. EVENT GATING. The original processed every event it received. An
 *     `order_created` payload carries `attributes.status = "paid"`, which fell
 *     through the status map to "inactive" — so a successful payment could
 *     immediately mark an active subscriber as inactive and lock them out.
 *     Only subscription-resource events are processed now.
 *
 *  2. VARIANT ID MAPPING. Plans are resolved from stable Lemon Squeezy variant
 *     ids supplied via environment variables, falling back to the original
 *     product/variant name matching when the ids aren't configured.
 *
 *  3. NO DESTRUCTIVE DEFAULT. The original wrote plan "none" whenever the
 *     product name was missing, wiping a paying customer's plan. If the plan
 *     can't be resolved, the field is simply left untouched.
 *
 *  4. IDENTITY MATCHING. Profiles are matched on the Supabase user id passed
 *     through checkout custom data when present, and fall back to email.
 *
 * Required environment variables:
 *   LEMONSQUEEZY_WEBHOOK_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * Optional but recommended:
 *   LEMON_STARTER_VARIANT_ID, LEMON_GROWTH_VARIANT_ID, LEMON_PRO_VARIANT_ID
 */

import crypto from "crypto";

/** Subscription-resource events that carry a full subscription payload. */
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

/** Lemon Squeezy subscription status -> our internal status. */
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

const text = (statusCode, body) => ({ statusCode, body });

/* ------------------------------------------------------------ signature -- */

function verifySignature(rawBody, signature, secret) {
  const digest = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(digest, "utf8");
  const b = Buffer.from(signature, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ----------------------------------------------------------------- plan -- */

/**
 * Resolve the plan from the variant id first, then the product/variant name.
 * Returns null when neither method is conclusive, so the caller can leave the
 * existing plan alone rather than overwrite it with a guess.
 */
function resolvePlan(attributes) {
  const variantMap = {
    [String(process.env.LEMON_STARTER_VARIANT_ID || "").trim()]: "starter",
    [String(process.env.LEMON_GROWTH_VARIANT_ID || "").trim()]: "growth",
    [String(process.env.LEMON_PRO_VARIANT_ID || "").trim()]: "pro",
  };
  delete variantMap[""]; // unconfigured ids must never match

  const variantId = String(attributes?.variant_id ?? "").trim();
  if (variantId && variantMap[variantId]) {
    return variantMap[variantId];
  }

  // Fallback: name matching, as in the original implementation.
  const name =
    attributes?.variant_name ||
    attributes?.product_name ||
    attributes?.product?.name;

  if (name) {
    const n = String(name).toLowerCase();
    if (n.includes("starter")) return "starter";
    if (n.includes("growth")) return "growth";
    if (n.includes("pro")) return "pro";
  }

  return null;
}

/* -------------------------------------------------------------- handler -- */

export async function handler(event) {
  try {
    if (event.httpMethod !== "POST") {
      return text(405, "Method not allowed");
    }

    const headers = event.headers || {};
    const signature = headers["x-signature"] || headers["X-Signature"];
    const eventName = String(
      headers["x-event-name"] || headers["X-Event-Name"] || ""
    ).toLowerCase();

    const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;

    if (!signature || !secret) {
      return text(400, "Missing signature or secret");
    }

    /* ------------------------------------------------ verify the sender -- */

    // Netlify may deliver the body base64-encoded; HMAC must run on raw bytes.
    const rawBody = event.isBase64Encoded
      ? Buffer.from(event.body || "", "base64").toString("utf8")
      : event.body || "";

    if (!verifySignature(rawBody, signature, secret)) {
      return text(401, "Invalid signature");
    }

    const payload = JSON.parse(rawBody);

    /* --------------------------------------------------- gate the event -- */

    // Acknowledge non-subscription events so Lemon Squeezy stops retrying,
    // but never let them write subscription state.
    if (eventName && !SUBSCRIPTION_EVENTS.has(eventName)) {
      return text(200, `Ignored event: ${eventName}`);
    }

    const data = payload?.data;
    const attributes = data?.attributes || {};

    // When the event-name header is absent, only continue if the payload
    // actually looks like a subscription.
    if (!eventName && !("variant_id" in attributes && "status" in attributes)) {
      return text(200, "Not a subscription payload; ignoring");
    }

    /* --------------------------------------------------------- identify -- */

    const customData = payload?.meta?.custom_data || {};

    const userId = customData.user_id || customData.userId || null;

    const userEmail =
      customData.email ||
      attributes?.user_email ||
      attributes?.customer_email ||
      attributes?.email ||
      null;

    if (!userId && !userEmail) {
      return text(200, "No user id or email found; ignoring");
    }

    /* ----------------------------------------------------- build the patch -- */

    const rawStatus = String(attributes?.status || "").toLowerCase();
    const status = STATUS_MAP[rawStatus] || "inactive";

    const patch = {
      status,
      ls_customer_id:
        attributes?.customer_id ??
        data?.relationships?.customer?.data?.id ??
        null,
      ls_subscription_id: data?.id || null,
      trial_ends_at: attributes?.trial_ends_at || attributes?.trial_end_at || null,
      current_period_end: attributes?.renews_at || attributes?.ends_at || null,
    };

    // Only write the plan when it was resolved. Never overwrite with a guess.
    const plan = resolvePlan(attributes);
    if (plan) patch.plan = plan;

    // A started Starter subscription consumes the one-time trial.
    if (plan === "starter" && (status === "trialing" || status === "active")) {
      patch.trial_used = true;
    }

    /* ------------------------------------------------------ write to db -- */

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRole) {
      console.error("Missing Supabase server configuration");
      return text(500, "Server not configured");
    }

    const patchProfiles = async (filter) => {
      const res = await fetch(`${supabaseUrl}/rest/v1/profiles?${filter}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          apikey: serviceRole,
          Authorization: `Bearer ${serviceRole}`,
          // return=representation so we can tell whether a row actually matched
          Prefer: "return=representation",
        },
        body: JSON.stringify(patch),
      });

      if (!res.ok) {
        const detail = await res.text();
        throw new Error(`Supabase PATCH ${res.status}: ${detail}`);
      }

      const rows = await res.json();
      return Array.isArray(rows) ? rows.length : 0;
    };

    let updated = 0;

    if (userId) {
      updated = await patchProfiles(`user_id=eq.${encodeURIComponent(userId)}`);
    }

    // Fall back to email if the id wasn't present or matched nothing.
    if (!updated && userEmail) {
      updated = await patchProfiles(`email=eq.${encodeURIComponent(userEmail)}`);
    }

    if (!updated) {
      // The customer paid before creating an account, or used a different
      // email. Log loudly — this needs a human, but returning non-200 would
      // just make Lemon Squeezy retry a request that can never succeed.
      console.warn(
        `[lemonsqueezy-webhook] ${eventName || "subscription event"}: no profile matched`,
        { userId, userEmail, subscriptionId: data?.id }
      );
      return text(200, "No matching profile; acknowledged");
    }

    return text(200, "ok");
  } catch (error) {
    console.error("Webhook error:", error);
    return text(500, `Webhook error: ${error.message}`);
  }
}
