/**
 * /account — plan details and billing management.
 * Reuses the exact access rules from session.js; no duplicated logic here.
 */

import { LIMITS, PLAN_META } from "./config.js";
import {
  requireSession,
  ensureProfile,
  getMonthlyUsage,
  evaluateAccess,
  resolveCheckoutUrl,
  fetchBillingPortalUrl,
  signOut,
} from "./session.js";
import { $, toast, setBusy, formatDate, megabytes } from "./ui.js";

let currentUser = null;
let currentProfile = null;
let currentAccess = null;

const splash = $("#splash");

async function boot() {
  const session = await requireSession();
  if (!session) return;

  currentUser = session.user;
  $("#userEmail").textContent = currentUser.email || "";

  currentProfile = await ensureProfile(currentUser);
  currentAccess = evaluateAccess(currentProfile);

  render();

  splash.classList.add("is-hidden");
  setTimeout(() => splash.remove(), 300);
}

async function render() {
  const planKey = LIMITS[currentAccess.plan] ? currentAccess.plan : "trial";
  const meta = PLAN_META[planKey];
  const limits = LIMITS[planKey];

  $("#detailEmail").textContent = currentUser.email || "—";

  const isStarterTrial = planKey === "starter" && currentAccess.isTrialing;
  $("#detailPlan").textContent = currentAccess.canUseApp
    ? `${isStarterTrial ? "Starter Trial" : meta?.name || "Trial"} · ${
        meta?.price || "—"
      } · ${megabytes(limits.maxBytes)} MB max per file`
    : "No active plan";

  const chip = $("#detailStatus");
  chip.className = "status-chip";
  if (currentAccess.status === "active") {
    chip.classList.add("status-done");
    chip.textContent = "Active";
  } else if (currentAccess.status === "trialing") {
    chip.classList.add("status-pending");
    chip.textContent = "Trialing";
  } else if (currentAccess.stillWithinPaidPeriod) {
    chip.classList.add("status-pending");
    chip.textContent = "Cancelled";
  } else {
    chip.classList.add("status-error");
    chip.textContent = "Inactive";
  }

  const used = await getMonthlyUsage(currentUser.id);
  $("#detailUsage").textContent =
    planKey === "pro" ? `${used} uploads` : `${used} of ${limits.filesPerMonth}`;

  if (currentAccess.periodEnd) {
    $("#renewRow").hidden = false;
    $("#renewLabel").textContent = currentAccess.stillWithinPaidPeriod
      ? "Access ends on"
      : "Renews on";
    $("#detailRenew").textContent = formatDate(currentAccess.periodEnd.toISOString());
  }

  if (currentProfile?.trial_ends_at && currentAccess.isTrialing) {
    $("#trialRow").hidden = false;
    $("#detailTrial").textContent = formatDate(currentProfile.trial_ends_at);
  }

  const hasCustomer = !!currentProfile?.ls_customer_id;
  $("#manageBtn").hidden = !hasCustomer;
  $("#cancelBtn").disabled = !hasCustomer;

  $("#upgradeBtn").textContent = currentAccess.canUseApp ? "Change plan" : "Choose a plan";
}

/* --------------------------------------------------------------- actions -- */

$("#upgradeBtn")?.addEventListener("click", (event) => {
  const url = resolveCheckoutUrl(currentProfile, currentUser);
  setBusy(event.currentTarget, "Opening checkout…");
  window.location.href = url;
});

async function openPortal(button, message) {
  const restore = setBusy(button, "Opening…");
  try {
    const url = await fetchBillingPortalUrl(currentProfile);
    window.open(url, "_blank", "noopener");
    toast("info", "Billing portal opened", message);
  } catch (error) {
    toast("error", "Billing portal unavailable", error.message);
  } finally {
    restore();
  }
}

$("#manageBtn")?.addEventListener("click", (event) =>
  openPortal(event.currentTarget, "Update your payment details or change plan in the new tab.")
);

$("#cancelBtn")?.addEventListener("click", (event) =>
  openPortal(
    event.currentTarget,
    "Open the billing portal to cancel your current subscription plan."
  )
);

$("#logoutBtn")?.addEventListener("click", async (event) => {
  setBusy(event.currentTarget, "Signing out…");
  await signOut();
});

boot().catch((error) => {
  console.error(error);
  splash?.remove();
  toast("error", "Couldn't load your account", error.message || "Please refresh the page.");
});
