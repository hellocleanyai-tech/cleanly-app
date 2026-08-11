/**
 * Shared Supabase browser client.
 *
 * The UMD bundle from the CDN registers itself as `window.supabase`, so the
 * created client is deliberately named `client` — never `supabase` — to avoid
 * shadowing the library global. Same convention as the original app.js.
 */

import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

if (!window.supabase || typeof window.supabase.createClient !== "function") {
  throw new Error(
    "Supabase library not loaded. The @supabase/supabase-js script tag must " +
      "come before this module."
  );
}

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    "Missing Supabase configuration. Check assets/js/env.js or the build-time " +
      "SUPABASE_URL / SUPABASE_ANON_KEY environment variables."
  );
}

export const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // Required so magic-link and OAuth callbacks landing on /app are consumed.
    detectSessionInUrl: true,
    flowType: "pkce",
  },
});

/** Absolute URL auth providers should return to. Never hard-coded per host. */
export function authRedirectUrl() {
  return `${window.location.origin}/app`;
}
