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
const app = document.getElementById("app");
const fileInput = document.getElementById("fileInput");
const uploadBtn = document.getElementById("uploadBtn");
const msg = document.getElementById("msg");
const list = document.getElementById("list");
const LIMITS = {
  trial:   { filesPerMonth: 3,  maxBytes: 2 * 1024 * 1024 },   // trial: 3 files, 2MB
  starter: { filesPerMonth: 10, maxBytes: 5 * 1024 * 1024 },   // 5MB
  growth:  { filesPerMonth: 50, maxBytes: 25 * 1024 * 1024 },  // 25MB
  pro:     { filesPerMonth: 999999, maxBytes: 100 * 1024 * 1024 } // 100MB
};
const sortSelect = document.getElementById("sortSelect");
if (sortSelect) {
  sortSelect.addEventListener("change", () => loadUploads());
}

let currentProfile = null;

async function refreshUI() {
  const { data: { user }, error } = await client.auth.getUser();

  if (!user) {
    loginBtn.style.display = "inline-block";
    logoutBtn.style.display = "none";
    app.style.display = "none";
    userInfo.textContent = "";
    return;
  }

    loginBtn.style.display = "none";
  logoutBtn.style.display = "inline-block";
  app.style.display = "block";
  userInfo.textContent = `Signed in as ${user.email}`;

  // Ensure profile exists (MVP)
  const up = await client.from("profiles").upsert(
    { user_id: user.id, email: user.email },
    { onConflict: "user_id" }
  );

  // Optional: show error if profile creation fails
  if (up.error) {
    console.warn("profiles upsert failed:", up.error.message);
  }
  
  //  FETCH profile and store globally
  const prof = await client
    .from("profiles")
    .select("*")
    .eq("user_id", user.id)
    .single();

  currentProfile = prof.data || null;

  await loadUploads();
}

loginBtn.addEventListener("click", async () => {
  const { error } = await client.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: "https://reliable-pudding-ff00ee.netlify.app/"
    }
  });

  if (error) {
    alert(error.message);
  }
});

logoutBtn.addEventListener("click", async () => {
  await client.auth.signOut();
  refreshUI();
});

uploadBtn.addEventListener("click", async () => {
  msg.textContent = "";

  const file = fileInput.files?.[0];
  if (!file) {
    msg.textContent = "Choose a CSV file first.";
    return;
  }

  if (!file.name.toLowerCase().endsWith(".csv")) {
    msg.textContent = "Please upload a .csv file.";
    return;
  }

  const { data: { user } } = await client.auth.getUser();
  if (!user) {
    msg.textContent = "Please sign in first.";
    return;
  }
  
  // ---- PLAN + LIMIT ENFORCEMENT (PASTE HERE) ----

// Load profile if not available
if (!currentProfile) {
  const prof = await client.from("profiles").select("*").eq("user_id", user.id).single();
  currentProfile = prof.data || null;
}

const plan = (currentProfile?.plan || "trial").toLowerCase();
const status = (currentProfile?.status || "inactive").toLowerCase();

// Gate access
const canUse = (status === "active" || status === "trialing");
if (!canUse) {
  msg.textContent = "Please subscribe to use Cleanly.";
  return;
}

const limits = LIMITS[plan] || LIMITS.trial;

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
