import crypto from "crypto";

export async function handler(event) {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method not allowed" };
    }

    const signature = event.headers["x-signature"] || event.headers["X-Signature"];
    const eventName = event.headers["x-event-name"] || event.headers["X-Event-Name"];
    const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;

    if (!signature || !secret) {
      return { statusCode: 400, body: "Missing signature or secret" };
    }

    // Verify signature (HMAC SHA256 of raw body using signing secret)
    const rawBody = event.body || "";
    const digest = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");

    const a = Buffer.from(digest, "utf8");
const b = Buffer.from(signature, "utf8");

if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
  return { statusCode: 401, body: "Invalid signature" };
}

    const payload = JSON.parse(rawBody);

    // Lemon Squeezy sends JSON:API style payloads for the resource related to the event. :contentReference[oaicite:2]{index=2}
    const data = payload?.data;
    const attributes = data?.attributes || {};

    // We need a way to map this subscription to your user.
    // Easiest MVP: use customer email from attributes where available.
    const userEmail =
      attributes?.user_email ||
      attributes?.customer_email ||
      attributes?.email ||
      payload?.meta?.custom_data?.email;

    if (!userEmail) {
      return { statusCode: 200, body: "No email found; ignoring" };
    }

    // Plan mapping: use product/variant name if present; fallback by price_id later
    const productName =
      attributes?.product_name ||
      attributes?.variant_name ||
      attributes?.product?.name;

    // Decide plan/status based on event
    // subscription_created / subscription_updated are the minimum you need. :contentReference[oaicite:3]{index=3}
    let plan = "trial";
    if (productName) {
      const n = String(productName).toLowerCase();
      if (n.includes("starter")) plan = "starter";
      else if (n.includes("growth")) plan = "growth";
      else if (n.includes("pro")) plan = "pro";
    }

   const rawStatus = String(attributes?.status || "").toLowerCase();

let status = "inactive";
if (rawStatus === "trialing") status = "trialing";
else if (rawStatus === "active") status = "active";
else if (rawStatus === "on_trial") status = "trialing";
else if (rawStatus === "cancelled") status = "inactive";
else if (rawStatus === "expired") status = "inactive";
else if (rawStatus === "past_due") status = "inactive";
else if (rawStatus === "unpaid") status = "inactive";

    const trialEndsAt = attributes?.trial_ends_at || attributes?.trial_end_at || null;
    const currentPeriodEnd = attributes?.renews_at || attributes?.ends_at || null;

    // Update Supabase profiles by email (server-side)
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;

    const res = await fetch(`${supabaseUrl}/rest/v1/profiles?email=eq.${encodeURIComponent(userEmail)}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "apikey": supabaseServiceRole,
        "Authorization": `Bearer ${supabaseServiceRole}`,
        "Prefer": "return=minimal"
      },
      body: JSON.stringify({
        plan,
        status,
        trial_ends_at: trialEndsAt,
        current_period_end: currentPeriodEnd
      })
    });

    // If no row found by email, you can handle this later (e.g., custom_data user_id).
    // For MVP, just return OK.
    return { statusCode: 200, body: "ok" };
  } catch (e) {
    return { statusCode: 500, body: `Webhook error: ${e.message}` };
  }
}