/**
 * /login — Google OAuth and email magic link.
 *
 * The old app hard-coded https://cleanlyai.netlify.app/ as the redirect target.
 * Both flows now return to the current origin, so the same code works on
 * localhost, on Netlify deploy previews and on the production domain.
 */

import { client, authRedirectUrl } from "./supabase-client.js";
import { $, setBusy } from "./ui.js";

const googleBtn = $("#googleBtn");
const emailBtn = $("#emailBtn");
const emailInput = $("#emailInput");
const formMsg = $("#formMsg");

/* --------------------------------------------------------------- helpers -- */

function showMessage(text, kind = "info") {
  formMsg.textContent = text;
  formMsg.classList.toggle("is-error", kind === "error");
  formMsg.classList.toggle("is-success", kind === "success");
  formMsg.hidden = false;
}

function clearMessage() {
  formMsg.hidden = true;
  formMsg.textContent = "";
  formMsg.classList.remove("is-error", "is-success");
}

/**
 * Where to land after a successful login. Honours ?next= when it is a
 * same-site path, so a deep link survives the login round-trip. Anything
 * that isn't a local path is ignored — this prevents an open redirect.
 */
function destination() {
  const next = new URLSearchParams(window.location.search).get("next");
  if (next && next.startsWith("/") && !next.startsWith("//")) {
    return `${window.location.origin}${next}`;
  }
  return authRedirectUrl();
}

/* ------------------------------------------------- already signed in? -- */

(async function redirectIfSignedIn() {
  const { data } = await client.auth.getSession();
  if (data?.session) window.location.replace(destination());
})();

/* -------------------------------------------------------------- google -- */

googleBtn?.addEventListener("click", async () => {
  clearMessage();
  const restore = setBusy(googleBtn, "Redirecting…");

  const { error } = await client.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: destination() },
  });

  if (error) {
    restore();
    showMessage(`Google sign-in failed: ${error.message}`, "error");
  }
  // On success the browser navigates away, so the busy state stays put.
});

/* ---------------------------------------------------------- magic link -- */

async function sendMagicLink() {
  clearMessage();

  const email = (emailInput?.value || "").trim().toLowerCase();

  if (!email) {
    showMessage("Enter your email address first.", "error");
    emailInput?.focus();
    return;
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    showMessage("That doesn't look like a valid email address.", "error");
    emailInput?.focus();
    return;
  }

  const restore = setBusy(emailBtn, "Sending…");
  emailInput.disabled = true;

  const { error } = await client.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: destination() },
  });

  restore();
  emailInput.disabled = false;

  if (error) {
    showMessage(`Couldn't send the login link: ${error.message}`, "error");
    return;
  }

  showMessage(
    `Login link sent to ${email}. Open it on this device to finish signing in. It expires in one hour.`,
    "success"
  );
}

emailBtn?.addEventListener("click", sendMagicLink);

emailInput?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    sendMagicLink();
  }
});

/* ----------------------------------------------- callback error surfacing -- */

// Supabase reports expired or reused links via the URL fragment.
const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
const authError = hashParams.get("error_description") || hashParams.get("error");
if (authError) {
  showMessage(decodeURIComponent(authError.replace(/\+/g, " ")), "error");
  history.replaceState({}, document.title, window.location.pathname + window.location.search);
}

// Signing in from another tab should move this one along too.
client.auth.onAuthStateChange((event, session) => {
  if (event === "SIGNED_IN" && session) window.location.replace(destination());
});
