/**
 * POST /.netlify/functions/get-customer-portal
 *
 * Returns the Lemon Squeezy customer portal URL for the SIGNED-IN customer.
 * The Lemon Squeezy API key never leaves the server.
 *
 * SECURITY NOTE — this differs from the original implementation on purpose.
 *
 * The original accepted any `customerId` from any caller and returned that
 * customer's portal URL. Lemon Squeezy customer ids are short sequential
 * integers, so anyone could have walked the range and collected working
 * billing-portal links for other people's accounts — links that expose the
 * customer's name, email, invoices and payment method, and allow cancelling
 * their subscription.
 *
 * The request is now authenticated:
 *   1. The caller must send their Supabase access token.
 *   2. The token is verified with Supabase.
 *   3. The requested customerId must match ls_customer_id on that user's own
 *      profile row, read server-side with the service role key.
 *
 * The response shape is unchanged: { url } on success.
 */

const LS_API = "https://api.lemonsqueezy.com/v1/customers";

const json = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(body),
});

export async function handler(event) {
  try {
    if (event.httpMethod !== "POST") {
      return json(405, { error: "Method not allowed" });
    }

    /* ------------------------------------------------- parse the request -- */

    let payload;
    try {
      payload = JSON.parse(event.body || "{}");
    } catch {
      return json(400, { error: "Invalid JSON body" });
    }

    const customerId = String(payload.customerId || "").trim();

    if (!customerId) {
      return json(400, { error: "Missing customerId" });
    }

    // Lemon Squeezy customer ids are numeric. Reject anything else before it
    // reaches the API so the id can't be used for path traversal.
    if (!/^\d+$/.test(customerId)) {
      return json(400, { error: "Invalid customerId" });
    }

    /* --------------------------------------------------- read the config -- */

    const apiKey = process.env.LEMONSQUEEZY_API_KEY;
    const supabaseUrl = process.env.SUPABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY;
    const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!apiKey) {
      console.error("Missing LEMONSQUEEZY_API_KEY");
      return json(500, { error: "Billing is not configured" });
    }

    if (!supabaseUrl || !anonKey || !serviceRole) {
      console.error("Missing Supabase server configuration");
      return json(500, { error: "Billing is not configured" });
    }

    /* ------------------------------------------------ verify the caller -- */

    const authHeader =
      event.headers.authorization || event.headers.Authorization || "";
    const accessToken = authHeader.replace(/^Bearer\s+/i, "").trim();

    if (!accessToken) {
      return json(401, { error: "Not signed in" });
    }

    const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}` },
    });

    if (!userRes.ok) {
      return json(401, { error: "Session expired. Sign in again." });
    }

    const user = await userRes.json();
    if (!user?.id) {
      return json(401, { error: "Session expired. Sign in again." });
    }

    /* ------------------------------- confirm the customer belongs to them -- */

    const profileRes = await fetch(
      `${supabaseUrl}/rest/v1/profiles?user_id=eq.${encodeURIComponent(
        user.id
      )}&select=ls_customer_id`,
      {
        headers: {
          apikey: serviceRole,
          Authorization: `Bearer ${serviceRole}`,
          Accept: "application/json",
        },
      }
    );

    if (!profileRes.ok) {
      console.error("Profile lookup failed:", profileRes.status);
      return json(500, { error: "Could not verify your account" });
    }

    const rows = await profileRes.json();
    const ownCustomerId = rows?.[0]?.ls_customer_id;

    if (!ownCustomerId || String(ownCustomerId) !== customerId) {
      // Deliberately vague: don't confirm whether the id exists.
      return json(403, { error: "No billing portal available for this account" });
    }

    /* ------------------------------------------------- fetch portal URL -- */

    const res = await fetch(`${LS_API}/${customerId}`, {
      headers: {
        Accept: "application/vnd.api+json",
        "Content-Type": "application/vnd.api+json",
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (!res.ok) {
      console.error("Lemon Squeezy customer fetch failed:", res.status);
      return json(502, { error: "Billing provider is unavailable right now" });
    }

    const body = await res.json();
    const portalUrl = body?.data?.attributes?.urls?.customer_portal || null;

    if (!portalUrl) {
      return json(404, { error: "No customer portal URL found" });
    }

    return json(200, { url: portalUrl });
  } catch (error) {
    // Log the detail, return something generic.
    console.error("get-customer-portal error:", error);
    return json(500, { error: "Unexpected error" });
  }
}
