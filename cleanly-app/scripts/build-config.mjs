#!/usr/bin/env node
/**
 * Generates public/assets/js/env.js from environment variables at build time.
 *
 * Only browser-safe values are written. The script hard-fails if a server
 * secret is ever passed in under a public name, so a misconfigured Netlify
 * environment can't quietly publish a service role key to the browser.
 *
 * Falls back to the committed defaults when a variable isn't set, so local
 * development works with no setup: `npx serve public`.
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(here, "../public/assets/js/env.js");

/* ------------------------------------------------------------- defaults -- */

const DEFAULTS = {
  SUPABASE_URL: "https://hupeqzyrzrtwymdoogbn.supabase.co",
  SUPABASE_ANON_KEY:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh1cGVxenlyenJ0d3ltZG9vZ2JuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA3NjIzNjEsImV4cCI6MjA4NjMzODM2MX0.b35ZtHuZ-Rqdm4eSwt1a4mgzfmqErXXC5_y7pBIwZeE",
  LS_CHECKOUT_URL: "https://cleanly-app.lemonsqueezy.com/checkout",
  LS_STARTER_TRIAL_URL:
    "https://cleanly-app.lemonsqueezy.com/checkout/buy/cf8736bf-e22c-4b68-95b0-c1dec48293ec",
  LS_STARTER_STANDARD_URL:
    "https://cleanly-app.lemonsqueezy.com/checkout/buy/b21dd36e-37ac-4a7a-86f1-88a57b94ec6d",
  SUPPORT_EMAIL: "support@cleanly.ai",
};

const config = {};
const sources = {};

for (const [key, fallback] of Object.entries(DEFAULTS)) {
  const value = process.env[key];
  config[key] = value && value.trim() ? value.trim() : fallback;
  sources[key] = value && value.trim() ? "env" : "default";
}

/* --------------------------------------------------------- safety check -- */

// A Supabase JWT encodes its role. Decode the payload and refuse to publish
// anything that isn't the anon key.
function jwtRole(token) {
  try {
    const [, payload] = String(token).split(".");
    if (!payload) return null;
    const decoded = JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
    return decoded.role || null;
  } catch {
    return null;
  }
}

const role = jwtRole(config.SUPABASE_ANON_KEY);

if (role && role !== "anon") {
  console.error(
    `\n  ✗ REFUSING TO BUILD\n` +
      `    SUPABASE_ANON_KEY contains a "${role}" key, not an anon key.\n` +
      `    This would expose privileged database access in browser JavaScript.\n` +
      `    Set SUPABASE_ANON_KEY to the anon/public key from Supabase.\n`
  );
  process.exit(1);
}

// Belt and braces: never let a known secret name end up in the bundle.
for (const secret of [
  "SUPABASE_SERVICE_ROLE_KEY",
  "LEMONSQUEEZY_API_KEY",
  "LEMONSQUEEZY_WEBHOOK_SECRET",
]) {
  const value = process.env[secret];
  if (!value) continue;
  const leaked = Object.entries(config).find(([, v]) => v === value);
  if (leaked) {
    console.error(
      `\n  ✗ REFUSING TO BUILD\n` +
        `    ${secret} was also supplied as ${leaked[0]}, which is public.\n`
    );
    process.exit(1);
  }
}

/* ---------------------------------------------------------------- write -- */

const banner = `/**
 * GENERATED FILE — do not edit by hand.
 * Written by scripts/build-config.mjs at ${new Date().toISOString()}.
 *
 * Browser-safe values only. The Supabase anon key is public by design and is
 * protected by Row Level Security. Server secrets never appear here.
 */`;

writeFileSync(
  target,
  `${banner}\nwindow.__CLEANLY_ENV__ = ${JSON.stringify(config, null, 2)};\n`,
  "utf8"
);

console.log("  ✓ Wrote public/assets/js/env.js");
for (const [key, source] of Object.entries(sources)) {
  const flag = source === "env" ? "env var" : "default";
  console.log(`      ${key.padEnd(24)} ${flag}`);
}
