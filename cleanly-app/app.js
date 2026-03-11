const SUPABASE_URL = "https://hupeqzyrzrtwymdoogbn.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh1cGVxenlyenJ0d3ltZG9vZ2JuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA3NjIzNjEsImV4cCI6MjA4NjMzODM2MX0.b35ZtHuZ-Rqdm4eSwt1a4mgzfmqErXXC5_y7pBIwZeE";

// IMPORTANT: do NOT name this variable `supabase`
const client = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

const loginBtn = document.getElementById("loginBtn");
const logoutBtn = document.getElementById("logoutBtn");
const userInfo = document.getElementById("userInfo");
const emailInput = document.getElementById("emailInput");
const emailLoginBtn = document.getElementById("emailLoginBtn");
const app = document.getElementById("app");
const fileInput = document.getElementById("fileInput");
const uploadBtn = document.getElementById("uploadBtn");
const msg = document.getElementById("msg");
const list = document.getElementById("list");
const cancelPlanBtn = document.getElementById("cancelPlanBtn");
const upgradeBtn = document.getElementById("upgradeBtn");
const LIMITS = {
  trial:   { filesPerMonth: 3,  maxBytes: 2 * 1024 * 1024 },   // trial: 3 files, 2MB
  starter: { filesPerMonth: 10, maxBytes: 5 * 1024 * 1024 },   // 5MB
  growth:  { filesPerMonth: 50, maxBytes: 25 * 1024 * 1024 },  // 25MB
  pro:     { filesPerMonth: 999999, maxBytes: 100 * 1024 * 1024 } // 100MB
};

const CHECKOUTS = {
  starterTrial: "PASTE_STARTER_TRIAL_CHECKOUT_URL_HERE",
  starterStandard: "PASTE_STARTER_STANDARD_CHECKOUT_URL_HERE",
  growth: "PASTE_GROWTH_CHECKOUT_URL_HERE",
  pro: "PASTE_PRO_CHECKOUT_URL_HERE",
  pricingPage: "https://YOUR-FRAMER-DOMAIN.com/pricing"
};

const sortSelect = document.getElementById("sortSelect");
if (sortSelect) {
  sortSelect.addEventListener("change", () => loadUploads());
}

let currentProfile = null;

async function getMonthlyUsage(userId) {
  const startOfMonth = new Date();
  startOfMonth.setUTCDate(1);
  startOfMonth.setUTCHours(0, 0, 0, 0);

  const { count, error } = await client
    .from("uploads")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", startOfMonth.toISOString());

  if (error) {
    console.warn("usage count failed:", error.message);
    return 0;
  }

  return count || 0;
}

async function refreshUI() {
  const { data: { user }, error } = await client.auth.getUser();

  if (!user) {
    loginBtn.style.display = "inline-block";
    logoutBtn.style.display = "none";
    app.style.display = "none";
    userInfo.textContent = "";
	  if (emailInput) emailInput.style.display = "inline-block";
  if (emailLoginBtn) emailLoginBtn.style.display = "inline-block";

	const planCard = document.getElementById("planCard");
if (planCard) planCard.innerHTML = "";
    return;
  }

    loginBtn.style.display = "none";
  logoutBtn.style.display = "inline-block";
  userInfo.textContent = `Signed in as ${user.email}`;
  if (emailInput) emailInput.style.display = "none";
if (emailLoginBtn) emailLoginBtn.style.display = "none";


  // Ensure profile exists
await client
  .from("profiles")
  .upsert(
    { user_id: user.id, email: user.email },
    { onConflict: "user_id" }
  );

// Load profile
const prof = await client
  .from("profiles")
  .select("*")
  .eq("user_id", user.id)
  .single();

currentProfile = prof.data || null;

if (cancelPlanBtn) cancelPlanBtn.style.display = "none";
if (upgradeBtn) upgradeBtn.style.display = "none";

const statusForButtons = String(currentProfile?.status || "inactive").toLowerCase();
const canUseButtons = (statusForButtons === "trialing" || statusForButtons === "active");

if (upgradeBtn) {
  upgradeBtn.style.display = "inline-block";
}

if (cancelPlanBtn && canUseButtons) {
  cancelPlanBtn.style.display = "inline-block";
}

const planCard = document.getElementById("planCard");
if (planCard && currentProfile) {
  const plan = String(currentProfile.plan || "none").toLowerCase();
  const uploadsUsed = await getMonthlyUsage(user.id);

  let label = "No Plan";
  let helper = "Choose a plan to get started.";
  let bg = "#eee";

  if (plan === "starter") {
    label = currentProfile.status === "trialing" ? "Starter Trial" : "Starter";
    helper = `10 uploads/month • 5MB max per file • Used: ${uploadsUsed}/10`;
    bg = "#dbeafe";
  } else if (plan === "growth") {
    label = "Growth";
    helper = `50 uploads/month • 25MB max per file • Used: ${uploadsUsed}/50`;
    bg = "#ede9fe";
  } else if (plan === "pro") {
    label = "Pro";
    helper = `Unlimited uploads • 100MB max per file • Used: ${uploadsUsed}`;
    bg = "#fef3c7";
  }

  planCard.innerHTML = `
    <div style="padding:12px; border-radius:12px; background:${bg}; border:1px solid #ddd;">
      <div style="font-weight:700;">${label}</div>
      <div style="font-size:14px; margin-top:4px;">${helper}</div>
    </div>
  `;
}

const statusNow = String(currentProfile?.status || "inactive").toLowerCase();
const periodEnd = currentProfile?.current_period_end
  ? new Date(currentProfile.current_period_end)
  : null;
const now = new Date();

const stillWithinPaidPeriod =
  statusNow === "inactive" &&
  periodEnd &&
  periodEnd > now &&
  ["starter", "growth", "pro"].includes(
    String(currentProfile?.plan || "").toLowerCase()
  );

const canUseApp =
  statusNow === "trialing" ||
  statusNow === "active" ||
  stillWithinPaidPeriod;

if (!canUseApp) {
  app.style.display = "none";
  msg.textContent = "No active subscription found. Please choose a plan to continue.";

  const trialUsed = !!currentProfile?.trial_used;

  let pricingBtn = document.getElementById("pricingBtn");
  if (!pricingBtn) {
    pricingBtn = document.createElement("button");
    pricingBtn.id = "pricingBtn";
    pricingBtn.style.marginTop = "12px";
    document.body.appendChild(pricingBtn);
  }

  if (!trialUsed) {
    pricingBtn.textContent = "Start Starter Trial";
    pricingBtn.onclick = () => {
      window.location.href = CHECKOUTS.starterTrial;
    };
  } else {
    pricingBtn.textContent = "Choose a Plan";
    pricingBtn.onclick = () => {
      window.location.href = CHECKOUTS.pricingPage;
    };
  }

  return;
}

if (stillWithinPaidPeriod) {
  msg.textContent = `Your plan has been canceled. You can keep using it until ${new Date(currentProfile.current_period_end).toLocaleDateString()}.`;
}

// remove pricing button if user becomes active/trialing
const oldPricingBtn = document.getElementById("pricingBtn");
if (oldPricingBtn) {
  oldPricingBtn.remove();
}

app.style.display = "block";
await loadUploads();
}

loginBtn.addEventListener("click", async () => {
  const { error } = await client.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: "https://cleanlyai.netlify.app/"
    }
  });

  if (error) {
    alert(error.message);
  }
});

if (emailLoginBtn) {
  emailLoginBtn.addEventListener("click", async () => {
    const email = (emailInput?.value || "").trim().toLowerCase();

    if (!email) {
      msg.textContent = "Enter your email first.";
      return;
    }

    const { error } = await client.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: "https://cleanlyai.netlify.app/"
      }
    });

    if (error) {
      msg.textContent = "Could not send login link: " + error.message;
      return;
    }

    msg.textContent = "Login link sent. Check your email inbox.";
  });
}


logoutBtn.addEventListener("click", async () => {
  await client.auth.signOut();
  refreshUI();
});

if (upgradeBtn) {
  upgradeBtn.addEventListener("click", async () => {
    const { data: { user } } = await client.auth.getUser();

    if (!user) {
      msg.textContent = "Please sign in first.";
      return;
    }

    const prof = await client
      .from("profiles")
      .select("plan,status,trial_used")
      .eq("user_id", user.id)
      .single();

    if (prof.error || !prof.data) {
      msg.textContent = "Could not load your subscription info.";
      return;
    }

    const status = String(prof.data.status || "inactive").toLowerCase();
    const trialUsed = !!prof.data.trial_used;

    // If already active/trialing, send to pricing page for upgrades
    if (status === "active" || status === "trialing") {
      window.location.href = CHECKOUTS.pricingPage;
      return;
    }

    // If inactive and trial never used -> Starter Trial
    if (!trialUsed) {
      window.location.href = CHECKOUTS.starterTrial;
      return;
    }

    // If inactive and trial already used -> Starter Standard
    window.location.href = CHECKOUTS.starterStandard;
  });
}

if (cancelPlanBtn) {
  cancelPlanBtn.addEventListener("click", async () => {
    if (!currentProfile?.ls_customer_id) {
      msg.textContent = "Customer portal not available yet.";
      return;
    }

    const res = await fetch("/.netlify/functions/get-customer-portal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customerId: currentProfile.ls_customer_id })
    });

    const json = await res.json();

    if (!res.ok || !json.url) {
      msg.textContent = "Could not open subscription portal.";
      return;
    }

    window.open(json.url, "_blank");
    msg.textContent = "Open the billing portal to cancel your current subscription plan.";
  });
}

uploadBtn.addEventListener("click", async () => {
  msg.textContent = "";
  
  // ===== HARD GATE (CARD-REQUIRED TRIAL) =====
  const { data: { user } } = await client.auth.getUser();
  if (!user) {
    msg.textContent = "Please sign in first.";
    return;
  }

  const profNow = await client
    .from("profiles")
    .select("plan,status")
    .eq("user_id", user.id)
    .single();

  if (profNow.error || !profNow.data) {
    msg.textContent = "Profile not found. Please refresh and try again.";
    return;
  }

  const statusNow = String(profNow.data.status || "inactive").toLowerCase();

  // Only allow uploads if payment has started (trialing or active)
  const canUse = (statusNow === "trialing" || statusNow === "active");

  if (!canUse) {
    msg.textContent = "Start your 48-hour trial (card required) to upload, or choose a plan.";
    return;
  }

  // Use plan for limits below
  const planNow = String(profNow.data.plan || "trial").toLowerCase();
  const limits = LIMITS[planNow] || LIMITS.trial;
  // ===== END HARD GATE =====

  const file = fileInput.files?.[0];
  if (!file) {
    msg.textContent = "Choose a CSV file first.";
    return;
  }

  if (!file.name.toLowerCase().endsWith(".csv")) {
    msg.textContent = "Please upload a .csv file.";
    return;
  }

 
  
 

// Enforce file size
if (file.size > limits.maxBytes) {
  msg.textContent = `File too large for your plan. Max ${Math.round(limits.maxBytes / 1024 / 1024)}MB.`;
  return;
}

// Enforce monthly file count (by counting uploads in DB for this user this month)
const startOfMonth = new Date();
startOfMonth.setUTCDate(1);
startOfMonth.setUTCHours(0, 0, 0, 0);

const { count, error: countErr } = await client
  .from("uploads")
  .select("id", { count: "exact", head: true })
  .eq("user_id", user.id)
  .gte("created_at", startOfMonth.toISOString());

if (countErr) {
  msg.textContent = "Could not check usage. Try again.";
  return;
}

if (count >= limits.filesPerMonth) {
  msg.textContent = "You’ve hit your monthly upload limit. Please upgrade your plan.";
  return;
}

// ---- END PLAN + LIMIT ENFORCEMENT ----

  // 1) Create DB row FIRST so we get a single upload id (the row id)
const ins = await client
  .from("uploads")
  .insert({
    user_id: user.id,
    status: "uploading",
    original_path: "placeholder", // temporary, we update it right after upload
	original_filename: file.name
  })
  .select("id")
  .single();

if (ins.error) {
  msg.textContent = `Database insert failed: ${ins.error.message}`;
  return;
}

const uploadId = ins.data.id; // ✅ the database row id
const originalPath = `${user.id}/${uploadId}/original.csv`;

// 2) Upload file using the SAME uploadId folder
const up = await client.storage.from("files").upload(originalPath, file, {
  contentType: "text/csv",
  upsert: false
});

if (up.error) {
  msg.textContent = `Upload failed: ${up.error.message}`;
  return;
}

// 3) Update the row with the real original_path
const upd = await client
  .from("uploads")
  .update({ original_path: originalPath, status: "pending" })
  .eq("id", uploadId);

if (upd.error) {
  msg.textContent = `Database update failed: ${upd.error.message}`;
  return;
}

  

  msg.textContent = "Upload successful. Cleaning in progress…";
  fileInput.value = "";

  await loadUploads();
});

async function downloadCleaned(cleanedPath, originalFilename) {
  const raw = (cleanedPath || "")
    .trim()
    .replace(/^\/+/, "")
    .replace(/^files\//, "")
    .split("?")[0]
    .replace(/\r?\n|\r/g, "")
    .replace(/\s+/g, "");

  const { data, error } = await client.storage.from("files").createSignedUrl(raw, 600);

  if (error || !data?.signedUrl) {
    msg.textContent = "File not available yet. Please try again shortly.";
    return;
  }

  // Build download filename: "<original name> - cleaned.csv"
  const base = (originalFilename || "file.csv").replace(/\.csv$/i, "");
  const niceName = `${base} - cleaned.csv`;

  const res = await fetch(data.signedUrl);
  if (!res.ok) {
    msg.textContent = "Download failed. Please try again.";
    return;
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = niceName;
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
}

function formatDateTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  // Example: 25 Feb 2026, 14:07
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

async function loadUploads() {
  const { data, error } = await client
    .from("uploads")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    list.innerHTML = `<p style="color:#b00;">Error loading uploads: ${error.message}</p>`;
    return;
  }

  if (!data || data.length === 0) {
    list.innerHTML = `<p>No uploads yet.</p>`;
    return;
  }
  
  
  const sortMode = sortSelect?.value || "newest";

if (sortMode === "oldest") {
  data.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
} else if (sortMode === "name") {
  data.sort((a, b) => (a.original_filename || "").localeCompare(b.original_filename || ""));
} else {
  // newest
  data.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

    list.innerHTML = data.map(u => `
  <div style="border:1px solid #ddd; border-radius:12px; padding:12px; margin:10px 0;">
    <div><b>File:</b> ${u.original_filename || "(unknown filename)"}</div>
	<div><b>Uploaded:</b> ${formatDateTime(u.created_at)}</div>
    <div><b>Status:</b> ${u.status}</div>
    <div><b>Cleaned file:</b> ${
      u.status === "done" && u.original_filename
        ? u.original_filename.replace(/\.csv$/i, "") + " - cleaned.csv"
        : "(not ready)"
    }</div>

    ${u.status === "done" && u.cleaned_path ? `
      <button
        class="dlBtn"
        data-path="${(u.cleaned_path || "").replace(/"/g, "&quot;")}"
        data-original="${(u.original_filename || "file.csv").replace(/"/g, "&quot;")}"
        style="margin-top:10px; padding:8px 12px; border-radius:10px; border:1px solid #333; cursor:pointer;"
      >
        Download cleaned CSV
      </button>
    ` : ""}
  </div>
`).join("");

  // Attach click handlers safely after rendering (no inline onclick)
  document.querySelectorAll(".dlBtn").forEach(btn => {
  btn.addEventListener("click", () => {
    const p = btn.getAttribute("data-path");
const orig = btn.getAttribute("data-original");
downloadCleaned(p, orig);
  });
});
}
client.auth.onAuthStateChange(() => {
  refreshUI();
});

refreshUI();
