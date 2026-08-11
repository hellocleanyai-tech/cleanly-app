/**
 * Marketing homepage behaviour.
 * No Supabase, no dependencies — this page must stay fast.
 */

const nav = document.getElementById("siteNav");
const toggle = document.getElementById("navToggle");
const links = document.getElementById("navLinks");

/* -------------------------------------------------------- sticky header -- */

let ticking = false;
function onScroll() {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    nav?.classList.toggle("is-stuck", window.scrollY > 8);
    ticking = false;
  });
}
window.addEventListener("scroll", onScroll, { passive: true });
onScroll();

/* ----------------------------------------------------------- mobile nav -- */

function closeMenu() {
  nav?.classList.remove("is-open");
  toggle?.setAttribute("aria-expanded", "false");
  toggle?.setAttribute("aria-label", "Open menu");
}

toggle?.addEventListener("click", () => {
  const open = nav.classList.toggle("is-open");
  toggle.setAttribute("aria-expanded", String(open));
  toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
});

// Close after tapping any link inside the panel.
nav?.addEventListener("click", (event) => {
  if (event.target.closest("a")) closeMenu();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && nav?.classList.contains("is-open")) {
    closeMenu();
    toggle?.focus();
  }
});

// Reset the mobile panel if the viewport grows past the breakpoint.
window.matchMedia("(min-width: 901px)").addEventListener("change", (e) => {
  if (e.matches) closeMenu();
});

/* -------------------------------------------------------- smooth scroll -- */

/**
 * Anchor links scroll smoothly and move keyboard focus to the target, so
 * keyboard and screen-reader users land in the same place as everyone else.
 */
document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
  anchor.addEventListener("click", (event) => {
    const id = anchor.getAttribute("href").slice(1);
    if (!id) return;

    const target = document.getElementById(id);
    if (!target) return;

    event.preventDefault();

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });

    target.setAttribute("tabindex", "-1");
    target.focus({ preventScroll: true });

    if (id !== "top") history.replaceState(null, "", `#${id}`);
    else history.replaceState(null, "", window.location.pathname);
  });
});

/* ------------------------------------------------------ active section -- */

const sections = ["features", "how-it-works", "pricing", "faq"]
  .map((id) => document.getElementById(id))
  .filter(Boolean);

if (sections.length && "IntersectionObserver" in window) {
  const spy = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        document.querySelectorAll(".nav-links a").forEach((link) => {
          link.setAttribute(
            "aria-current",
            link.getAttribute("href") === `#${entry.target.id}` ? "true" : "false"
          );
        });
      });
    },
    { rootMargin: "-45% 0px -50% 0px" }
  );
  sections.forEach((section) => spy.observe(section));
}

/* -------------------------------------------------------- scroll reveal -- */

const revealables = document.querySelectorAll(".reveal");

const showAll = () => revealables.forEach((node) => node.classList.add("is-visible"));

if ("IntersectionObserver" in window) {
  const reveal = new IntersectionObserver(
    (entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    },
    { rootMargin: "0px 0px -12% 0px", threshold: 0.05 }
  );
  revealables.forEach((node) => reveal.observe(node));

  // Failsafe: nothing stays invisible for more than three seconds, whatever
  // happens to the observer.
  setTimeout(showAll, 3000);
} else {
  showAll();
}

/* --------------------------------------------------------------- misc -- */

const year = document.getElementById("year");
if (year) year.textContent = String(new Date().getFullYear());
