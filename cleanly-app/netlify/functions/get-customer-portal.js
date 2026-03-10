export async function handler(event) {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method not allowed" };
    }

    const { customerId } = JSON.parse(event.body || "{}");

    if (!customerId) {
      return { statusCode: 400, body: "Missing customerId" };
    }

    const apiKey = process.env.LEMONSQUEEZY_API_KEY;
    if (!apiKey) {
      return { statusCode: 500, body: "Missing LEMONSQUEEZY_API_KEY" };
    }

    const res = await fetch(`https://api.lemonsqueezy.com/v1/customers/${customerId}`, {
      headers: {
        "Accept": "application/vnd.api+json",
        "Content-Type": "application/vnd.api+json",
        "Authorization": `Bearer ${apiKey}`
      }
    });

    const json = await res.json();

    const portalUrl = json?.data?.attributes?.urls?.customer_portal || null;

    if (!portalUrl) {
      return { statusCode: 404, body: "No customer portal URL found" };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ url: portalUrl })
    };
  } catch (e) {
    return { statusCode: 500, body: e.message };
  }
}