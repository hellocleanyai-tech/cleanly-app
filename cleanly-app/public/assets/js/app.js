/**
 * /app — authenticated Cleanly AI dashboard.
 *
 * Business logic is a refactor of the original app.js, not a rewrite. The
 * upload sequence, limit checks, storage paths and download naming are
 * deliberately unchanged. What is new: the design, safe DOM rendering
 * (filenames are no longer interpolated into innerHTML), styled notifications
 * instead of alert(), and live status polling.
 */

import { client } from "./supabase-client.js";
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
import {
  $,
  el,
  icon,
  toast,
  setBusy,
  formatDateTime,
  formatDate,
  formatBytes,
  megabytes,
  cleanedFilename,
} from "./ui.js";

/* ---------------------------------------------------------------- state -- */

let currentUser = null;
let currentProfile = null;
let currentAccess = null;
let selectedFile = null;
let uploads = [];
let pollTimer = null;

const STATUSES_IN_FLIGHT = new Set(["uploading", "pending", "processing"]);

/* -------------------------------------------------------------- element -- */

const splash = $("#splash");
const userEmail = $("#userEmail");
const logoutBtn = $("#logoutBtn");

const graceBanner = $("#graceBanner");
const graceText = $("#graceText");

const paywall = $("#paywall");
const paywallTitle = $("#paywallTitle");
const paywallText = $("#paywallText");
const paywallBtn = $("#paywallBtn");

const appArea = $("#appArea");
const planName = $("#planName");
const planStatus = $("#planStatus");
const upgradeBtn = $("#upgradeBtn");
const manageBtn = $("#manageBtn");

const usageValue = $("#usageValue");
const usageBar = $("#usageBar");
const usageNote = $("#usageNote");
const sizeValue = $("#sizeValue");
const sizeNote = $("#sizeNote");

const dropzone = $("#dropzone");
const dropzoneHint = $("#dropzoneHint");
const fileInput = $("#fileInput");
const fileChip = $("#fileChip");
const fileChipName = $("#fileChipName");
const fileChipSize = $("#fileChipSize");
const fileChipClear = $("#fileChipClear");
const uploadBtn = $("#uploadBtn");
const uploadHint = $("#uploadHint");

const sortSelect = $("#sortSelect");
const uploadsRegion = $("#uploadsRegion");
const uploadsCount = $("#uploadsCount");

/* ----------------------------------------------------------------- boot -- */

async function boot() {
  const session = await requireSession();
  if (!session) return; // redirecting to /login

  currentUser = session.user;
  userEmail.textContent = currentUser.email || "";

  currentProfile = await ensureProfile(currentUser);
  currentAccess = evaluateAccess(currentProfile);

  hideSplash();

  if (!currentAccess.canUseApp) {
    renderPaywall();
    return;
  }

  appArea.hidden = false;
  renderGraceBanner();
  await Promise.all([renderPlan(), loadUploads()]);
}

function hideSplash() {
  splash.classList.add("is-hidden");
  setTimeout(() => splash.remove(), 300);
}

/* -------------------------------------------------------------- paywall -- */

function renderPaywall() {
  appArea.hidden = true;
  paywall.hidden = false;

  const checkoutUrl = resolveCheckoutUrl(currentProfile, currentUser);

  if (!currentAccess.trialUsed) {
    paywallTitle.textContent = "Start your 48-hour trial";
    paywallText.textContent =
      "Start your 48-hour trial (card required) to upload, or choose a plan.";
    paywallBtn.textContent = "Start Starter Trial";
  } else {
    paywallTitle.textContent = "Choose a plan to continue";
    paywallText.textContent =
      "Your subscription isn't active, so uploads are paused. Pick a plan to pick up where you left off — your upload history is safe.";
    paywallBtn.textContent = "Choose a plan";
  }

  paywallBtn.onclick = () => {
    setBusy(paywallBtn, "Opening checkout…");
    window.location.href = checkoutUrl;
  };
}

/* ------------------------------------------------------------- plan card -- */

function planKey() {
  const plan = String(currentProfile?.plan || "").toLowerCase();
  return LIMITS[plan] ? plan : "trial";
}

function renderGraceBanner() {
  if (!currentAccess.stillWithinPaidPeriod || !currentAccess.periodEnd) {
    graceBanner.hidden = true;
    return;
  }
  graceText.textContent =
    `Your plan is cancelled. You keep full access until ${formatDate(
      currentAccess.periodEnd.toISOString()
    )}. Resubscribe any time before then to continue without interruption.`;
  graceBanner.hidden = false;
}

async function renderPlan() {
  const key = planKey();
  const limits = LIMITS[key];
  const meta = PLAN_META[key];

  // Starter during the trial reads "Starter Trial", as before.
  const isStarterTrial = key === "starter" && currentAccess.isTrialing;
  planName.textContent = isStarterTrial ? "Starter Trial" : meta?.name || "Trial";

  planStatus.hidden = false;
  planStatus.className = "status-chip";
  if (currentAccess.status === "active") {
    planStatus.classList.add("status-done");
    planStatus.textContent = "Active";
  } else if (currentAccess.status === "trialing") {
    planStatus.classList.add("status-pending");
    planStatus.textContent = "Trialing";
  } else {
    planStatus.classList.add("status-pending");
    planStatus.textContent = "Cancelled";
  }

  // Billing portal only makes sense once Lemon Squeezy knows the customer.
  manageBtn.hidden = !currentProfile?.ls_customer_id;

  // File size meter
  sizeValue.textContent = `${megabytes(limits.maxBytes)} MB`;
  sizeNote.textContent = `${meta?.name || "Trial"} allows files up to ${megabytes(
    limits.maxBytes
  )} MB each.`;
  dropzoneHint.textContent = `.csv files only · up to ${megabytes(limits.maxBytes)} MB`;

  // Usage meter
  const used = await getMonthlyUsage(currentUser.id);
  const unlimited = key === "pro";

  usageValue.textContent = unlimited
    ? `${used} used`
    : `${used} / ${limits.filesPerMonth}`;

  const ratio = unlimited ? 0.08 : Math.min(used / limits.filesPerMonth, 1);
  usageBar.style.width = `${Math.max(ratio * 100, used > 0 ? 4 : 0)}%`;
  usageBar.classList.toggle("is-full", !unlimited && used >= limits.filesPerMonth);
  usageBar.classList.toggle(
    "is-warn",
    !unlimited && used < limits.filesPerMonth && ratio >= 0.8
  );

  if (unlimited) {
    usageNote.textContent = "Unlimited uploads on Pro.";
  } else {
    const left = Math.max(limits.filesPerMonth - used, 0);
    usageNote.textContent =
      left === 0
        ? "You've used every upload this month. Upgrade for more."
        : `${left} upload${left === 1 ? "" : "s"} left. Resets on the 1st of each month.`;
  }

  if (currentAccess.isTrialing && currentProfile?.trial_ends_at) {
    usageNote.textContent += ` Trial ends ${formatDate(currentProfile.trial_ends_at)}.`;
  }
}

/* ------------------------------------------------------------- checkout -- */

upgradeBtn?.addEventListener("click", () => {
  const url = resolveCheckoutUrl(currentProfile, currentUser);
  setBusy(upgradeBtn, "Opening checkout…");
  window.location.href = url;
});

manageBtn?.addEventListener("click", async () => {
  const restore = setBusy(manageBtn, "Opening…");
  try {
    const url = await fetchBillingPortalUrl(currentProfile);
    window.open(url, "_blank", "noopener");
    toast(
      "info",
      "Billing portal opened",
      "Change or cancel your plan in the new tab. Changes appear here within a minute."
    );
  } catch (error) {
    toast("error", "Billing portal unavailable", error.message);
  } finally {
    restore();
  }
});

logoutBtn?.addEventListener("click", async () => {
  setBusy(logoutBtn, "Signing out…");
  await signOut();
});

/* ------------------------------------------------------- file selection -- */

function selectFile(file) {
  if (!file) return;

  const limits = LIMITS[planKey()];

  if (!file.name.toLowerCase().endsWith(".csv")) {
    toast("error", "That isn't a CSV file", "Export your list as .csv and try again.");
    clearFile();
    return;
  }

  if (file.size > limits.maxBytes) {
    toast(
      "error",
      "File too large for your plan",
      `${formatBytes(file.size)} exceeds the ${megabytes(limits.maxBytes)} MB limit. Upgrade or split the file.`
    );
    clearFile();
    return;
  }

  selectedFile = file;
  fileChipName.textContent = file.name;
  fileChipSize.textContent = formatBytes(file.size);
  fileChip.classList.add("is-shown");
  uploadBtn.disabled = false;
  uploadHint.textContent = "";
}

function clearFile() {
  selectedFile = null;
  fileInput.value = "";
  fileChip.classList.remove("is-shown");
  uploadBtn.disabled = true;
}

dropzone?.addEventListener("click", () => fileInput.click());

dropzone?.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    fileInput.click();
  }
});

fileInput?.addEventListener("change", () => selectFile(fileInput.files?.[0]));
fileChipClear?.addEventListener("click", clearFile);

["dragenter", "dragover"].forEach((type) =>
  dropzone?.addEventListener(type, (event) => {
    event.preventDefault();
    dropzone.classList.add("is-dragging");
  })
);

["dragleave", "drop"].forEach((type) =>
  dropzone?.addEventListener(type, (event) => {
    event.preventDefault();
    if (type === "dragleave" && dropzone.contains(event.relatedTarget)) return;
    dropzone.classList.remove("is-dragging");
  })
);

dropzone?.addEventListener("drop", (event) => {
  const file = event.dataTransfer?.files?.[0];
  if (file) selectFile(file);
});

// Prevent a stray drop elsewhere from navigating away from the dashboard.
["dragover", "drop"].forEach((type) =>
  window.addEventListener(type, (event) => {
    if (!dropzone?.contains(event.target)) event.preventDefault();
  })
);

/* --------------------------------------------------------- upload flow -- */

uploadBtn?.addEventListener("click", handleUpload);

async function handleUpload() {
  if (!selectedFile) {
    toast("warn", "Choose a CSV file first");
    return;
  }

  const restore = setBusy(uploadBtn, "Uploading…");
  uploadHint.textContent = "";

  try {
    // 1. Require an authenticated user.
    const { data: userData } = await client.auth.getUser();
    const user = userData?.user;
    if (!user) {
      toast("error", "Session expired", "Sign in again to continue.");
      window.location.replace("/login");
      return;
    }

    // 2-3. Re-read the profile and require an active subscription. Checked
    //      server-side-of-truth at upload time, not just at page load.
    const { data: profNow, error: profErr } = await client
      .from("profiles")
      .select("plan,status,current_period_end")
      .eq("user_id", user.id)
      .single();

    if (profErr || !profNow) {
      toast("error", "Profile not found", "Refresh the page and try again.");
      return;
    }

    const statusNow = String(profNow.status || "inactive").toLowerCase();
    if (statusNow !== "trialing" && statusNow !== "active") {
      toast(
        "error",
        "No active subscription",
        "Start your 48-hour trial (card required) to upload, or choose a plan."
      );
      return;
    }

    const planNow = String(profNow.plan || "trial").toLowerCase();
    const limits = LIMITS[planNow] || LIMITS.trial;

    // 4-5. Require a .csv file.
    const file = selectedFile;
    if (!file.name.toLowerCase().endsWith(".csv")) {
      toast("error", "Please upload a .csv file");
      return;
    }

    // 6. Enforce the plan's file-size limit.
    if (file.size > limits.maxBytes) {
      toast(
        "error",
        "File too large for your plan",
        `Maximum ${megabytes(limits.maxBytes)} MB on your current plan.`
      );
      return;
    }

    // 7. Count this month's uploads.
    const startOfMonth = new Date();
    startOfMonth.setUTCDate(1);
    startOfMonth.setUTCHours(0, 0, 0, 0);

    const { count, error: countErr } = await client
      .from("uploads")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gte("created_at", startOfMonth.toISOString());

    if (countErr) {
      toast("error", "Couldn't check your usage", "Try again in a moment.");
      return;
    }

    // 8. Enforce the monthly upload limit.
    if (count >= limits.filesPerMonth) {
      toast(
        "error",
        "Monthly upload limit reached",
        "Upgrade your plan to keep cleaning files this month."
      );
      return;
    }

    // 9-10. Insert the row first so the id can be used in the storage path.
    const ins = await client
      .from("uploads")
      .insert({
        user_id: user.id,
        status: "uploading",
        original_path: "placeholder",
        original_filename: file.name,
      })
      .select("id")
      .single();

    if (ins.error) {
      toast("error", "Couldn't start the upload", ins.error.message);
      return;
    }

    const uploadId = ins.data.id;
    const originalPath = `${user.id}/${uploadId}/original.csv`;

    // 11. Upload into Supabase Storage.
    const up = await client.storage
      .from("files")
      .upload(originalPath, file, { contentType: "text/csv", upsert: false });

    if (up.error) {
      // Mark the row so a failed transfer doesn't sit at "uploading" forever.
      await client.from("uploads").update({ status: "error" }).eq("id", uploadId);
      toast("error", "Upload failed", up.error.message);
      return;
    }

    // 12. Hand the file to the cleaning pipeline.
    const upd = await client
      .from("uploads")
      .update({ original_path: originalPath, status: "pending" })
      .eq("id", uploadId);

    if (upd.error) {
      toast("error", "Couldn't queue the file", upd.error.message);
      return;
    }

    toast("success", "Upload complete", "Cleaning in progress — this usually takes under a minute.");
    clearFile();

    await Promise.all([loadUploads(), renderPlan()]);
  } catch (error) {
    toast("error", "Something went wrong", error.message || "Please try again.");
  } finally {
    restore();
    uploadBtn.disabled = !selectedFile;
  }
}

/* ------------------------------------------------------- upload history -- */

sortSelect?.addEventListener("change", () => renderUploads());

async function loadUploads() {
  uploadsRegion.setAttribute("aria-busy", "true");

  const { data, error } = await client
    .from("uploads")
    // Explicit user filter as defence in depth. RLS still enforces ownership.
    .select("id,status,original_filename,cleaned_path,created_at")
    .eq("user_id", currentUser.id)
    .order("created_at", { ascending: false });

  uploadsRegion.setAttribute("aria-busy", "false");

  if (error) {
    uploads = [];
    uploadsRegion.replaceChildren(
      el("div", { class: "banner banner-error" }, [
        `Couldn't load your uploads: ${error.message}`,
      ])
    );
    return;
  }

  uploads = data || [];
  renderUploads();
  schedulePoll();
}

function sortUploads(rows) {
  const mode = sortSelect?.value || "newest";
  const sorted = [...rows];

  if (mode === "oldest") {
    sorted.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  } else if (mode === "name") {
    sorted.sort((a, b) =>
      (a.original_filename || "").localeCompare(b.original_filename || "")
    );
  } else {
    sorted.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }

  return sorted;
}

function renderUploads() {
  if (!uploads.length) {
    uploadsCount.textContent = "";
    uploadsRegion.replaceChildren(
      el("div", { class: "empty" }, [
        el("div", { class: "empty-icon" }, [icon("inbox")]),
        el("h3", { text: "No uploads yet" }),
        el("p", { text: "Upload your first CSV to get started." }),
      ])
    );
    return;
  }

  uploadsCount.textContent = `${uploads.length} file${uploads.length === 1 ? "" : "s"}`;

  const list = el("ul", { class: "upload-list" });

  for (const row of sortUploads(uploads)) {
    const status = String(row.status || "").toLowerCase();
    const isDone = status === "done";
    const ready = isDone && !!row.cleaned_path;

    const subParts = [formatDateTime(row.created_at)];
    const sub = el("div", { class: "upload-sub" }, [subParts.join("")]);

    if (ready) {
      sub.append(
        " · ",
        el("span", {
          class: "cleaned",
          text: cleanedFilename(row.original_filename),
        })
      );
    } else if (isDone) {
      sub.append(" · Cleaned file not available");
    }

    const item = el("li", { class: "upload-row" }, [
      el("div", { class: "upload-meta" }, [
        el("div", {
          class: "upload-name",
          text: row.original_filename || "(unknown filename)",
          title: row.original_filename || "",
        }),
        sub,
      ]),
      el("span", {
        class: `status-chip status-${status || "pending"}`,
        text: status || "pending",
      }),
      ready
        ? el(
            "button",
            {
              class: "btn btn-ghost btn-sm",
              type: "button",
              onclick: (event) =>
                downloadCleaned(event.currentTarget, row.cleaned_path, row.original_filename),
            },
            [icon("download"), "Download"]
          )
        : el("span", { class: "sr-only", text: "Not ready yet" }),
    ]);

    list.append(item);
  }

  uploadsRegion.replaceChildren(list);
}

/* ------------------------------------------------------------- download -- */

async function downloadCleaned(button, cleanedPath, originalFilename) {
  const restore = setBusy(button, "Preparing…");

  try {
    // Normalise the stored path: strip leading slashes, an accidental bucket
    // prefix, query strings and stray whitespace. Same cleanup as before.
    const path = (cleanedPath || "")
      .trim()
      .replace(/^\/+/, "")
      .replace(/^files\//, "")
      .split("?")[0]
      .replace(/\r?\n|\r/g, "")
      .replace(/\s+/g, "");

    const { data, error } = await client.storage
      .from("files")
      .createSignedUrl(path, 600);

    if (error || !data?.signedUrl) {
      toast("warn", "File isn't ready yet", "Give it a moment and try again.");
      return;
    }

    const response = await fetch(data.signedUrl);
    if (!response.ok) {
      toast("error", "Download failed", "Please try again.");
      return;
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);

    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = cleanedFilename(originalFilename);
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  } catch (error) {
    toast("error", "Download failed", error.message || "Please try again.");
  } finally {
    restore();
  }
}

/* --------------------------------------------------------------- polling -- */

/**
 * Refresh while anything is still being cleaned, then stop. Keeps the status
 * column honest without the customer reloading, and costs nothing once every
 * file has settled.
 */
function schedulePoll() {
  clearTimeout(pollTimer);

  const busy = uploads.some((row) =>
    STATUSES_IN_FLIGHT.has(String(row.status || "").toLowerCase())
  );
  if (!busy || document.hidden) return;

  pollTimer = setTimeout(async () => {
    const previous = new Map(uploads.map((row) => [row.id, row.status]));
    await loadUploads();

    for (const row of uploads) {
      const before = previous.get(row.id);
      if (before === row.status) continue;
      if (row.status === "done") {
        toast("success", "Cleaning finished", `${row.original_filename} is ready to download.`);
      } else if (row.status === "error") {
        toast("error", "Cleaning failed", `${row.original_filename} couldn't be processed.`);
      }
    }
  }, 8000);
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && currentUser && currentAccess?.canUseApp) loadUploads();
});

/* ----------------------------------------------------------- auth watch -- */

client.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_OUT") window.location.replace("/login");
});

boot().catch((error) => {
  console.error(error);
  hideSplash();
  toast("error", "Couldn't load your dashboard", error.message || "Please refresh the page.");
});
