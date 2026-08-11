/**
 * Shared UI utilities: styled notifications, formatting and safe DOM helpers.
 * Replaces the browser `alert()` calls and the innerHTML string building used
 * by the original app.
 */

/* ------------------------------------------------------------------ dom -- */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/**
 * Build an element. Text is always set with textContent, never innerHTML, so
 * user-controlled values such as filenames can never inject markup.
 */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;

    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "html") node.innerHTML = value; // only for trusted icon markup
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else node.setAttribute(key, value === true ? "" : String(value));
  }

  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }

  return node;
}

/* --------------------------------------------------------------- toasts -- */

let stack = null;

function toastStack() {
  if (!stack) {
    stack = el("div", {
      class: "toast-stack",
      role: "status",
      "aria-live": "polite",
      "aria-atomic": "false",
    });
    document.body.append(stack);
  }
  return stack;
}

/**
 * Show a styled notification.
 * @param {"info"|"success"|"error"|"warn"} kind
 * @param {string} title
 * @param {string} [text]  Optional supporting detail.
 * @param {number} [ms]    Auto-dismiss delay; errors stay longer.
 */
export function toast(kind, title, text = "", ms) {
  const timeout = ms ?? (kind === "error" ? 9000 : 5000);
  const node = el("div", { class: `toast toast-${kind}` }, [
    el("span", { class: "toast-dot" }),
    el("div", { class: "toast-body" }, [
      el("div", { class: "toast-title", text: title }),
      text ? el("div", { class: "toast-text", text }) : null,
    ]),
    el("button", {
      class: "toast-close",
      type: "button",
      "aria-label": "Dismiss notification",
      text: "×",
      onclick: () => dismiss(node),
    }),
  ]);

  toastStack().append(node);
  if (timeout > 0) setTimeout(() => dismiss(node), timeout);
  return node;
}

function dismiss(node) {
  if (!node.isConnected || node.classList.contains("is-leaving")) return;
  node.classList.add("is-leaving");
  setTimeout(() => node.remove(), 200);
}

/* ------------------------------------------------------- button states -- */

/**
 * Put a button into a busy state with a spinner, returning a restore function.
 * Prevents double-submits on upload / checkout / portal actions.
 */
export function setBusy(button, label = "Working…") {
  if (!button) return () => {};

  const original = button.innerHTML;
  const wasDisabled = button.disabled;

  button.disabled = true;
  button.innerHTML = "";
  button.append(el("span", { class: "spinner", "aria-hidden": "true" }), label);

  return () => {
    button.innerHTML = original;
    button.disabled = wasDisabled;
  };
}

/* ----------------------------------------------------------- formatting -- */

export function formatDateTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export function megabytes(bytes) {
  return Math.round(bytes / 1024 / 1024);
}

/** Derive the cleaned filename: "contacts.csv" -> "contacts - cleaned.csv". */
export function cleanedFilename(originalFilename) {
  const base = (originalFilename || "file.csv").replace(/\.csv$/i, "");
  return `${base} - cleaned.csv`;
}

/* ---------------------------------------------------------------- icons -- */

export const ICONS = {
  check:
    '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10.5 8 14.5 16 6"/></svg>',
  upload:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/></svg>',
  file:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>',
  download:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><path d="M12 4v12m0 0 4.5-4.5M12 16l-4.5-4.5"/><path d="M4 18v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1"/></svg>',
  inbox:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 13h4l2 3h6l2-3h4"/><path d="M5.5 5h13l2.5 8v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4z"/></svg>',
  chevron:
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m4 6 4 4 4-4"/></svg>',
  sparkle:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v5m0 8v5M3 12h5m8 0h5M6 6l3 3m6 6 3 3M18 6l-3 3M9 15l-3 3"/></svg>',
  shield:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 4.5 6v5.5c0 4.5 3.1 8.2 7.5 9.5 4.4-1.3 7.5-5 7.5-9.5V6z"/><path d="m9 12 2 2 4-4"/></svg>',
  export:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-6"/><path d="M12 15V3m0 0L8 7m4-4 4 4"/></svg>',
  arrowLeft:
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3 5 8l5 5"/></svg>',
  plus:
    '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M9 3.5v11M3.5 9h11"/></svg>',
};

/** Inline an SVG string from ICONS into a span. Trusted markup only. */
export function icon(name, className = "") {
  return el("span", { class: className, "aria-hidden": "true", html: ICONS[name] || "" });
}
