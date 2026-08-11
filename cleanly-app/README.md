# Cleanly AI

One website. Marketing homepage, authentication, dashboard, CSV uploads,
subscriptions and Lemon Squeezy checkout — all under a single domain.

```
cleanly.ai          →  marketing homepage
cleanly.ai/login    →  Google OAuth + email magic link
cleanly.ai/app      →  dashboard (upload, history, downloads)
cleanly.ai/account  →  plan details and billing portal
```

---

## Why plain HTML/CSS/JS

The site is static files plus two Netlify functions. No React, no Next.js, no
build framework, and **no runtime dependencies** beyond a self-hosted copy of
the Supabase client.

That was a deliberate call, not laziness:

- There are three routes and no shared client-side state. The routing a
  framework would provide is four redirect rules in `netlify.toml`.
- The billing path already works. Rewriting it into a framework would mean
  re-testing every subscription state to gain nothing a customer can see.
- Pages load with one stylesheet and one small module each.

ES modules give the code structure without a bundler. If the product later
grows shared state across many routes, revisit this — but do it then, for a
reason, not now.

---

## Layout

```
├── netlify.toml                 routing, headers, build command
├── package.json
├── .env.example                 every variable, public vs server-only
├── scripts/
│   ├── build-config.mjs         env vars → public/assets/js/env.js
│   └── selftest.mjs             logic tests (npm test)
├── netlify/functions/
│   ├── get-customer-portal.js   authenticated Lemon Squeezy portal link
│   └── lemonsqueezy-webhook.js  subscription sync → Supabase
└── public/
    ├── index.html               marketing
    ├── login.html  app.html  account.html
    ├── privacy.html  terms.html  404.html
    └── assets/
        ├── css/  theme · marketing · app
        ├── js/   env · config · supabase-client · ui · session
        │         marketing · login · app · account
        └── vendor/supabase-js-2.45.4.js
```

**Where the logic lives**

| Concern | File |
|---|---|
| Plan limits, checkout URLs | `assets/js/config.js` |
| Access rules, profile, billing | `assets/js/session.js` |
| Upload flow, history, downloads | `assets/js/app.js` |
| Toasts, formatting, safe DOM | `assets/js/ui.js` |

`session.js` holds the subscription access rules in one place, so `/app` and
`/account` can never disagree about who is allowed in.

---

## Running it locally

```bash
npm run dev     # builds env.js, serves public/ on :8888
npm test        # 43 logic tests
```

For the Netlify functions you need the Netlify CLI:

```bash
npm i -g netlify-cli
netlify dev
```

Without the CLI the site works, but "Manage billing" won't (no functions).

---

## Environment variables

Set these in **Netlify → Site settings → Environment variables**. Copy
`.env.example` to `.env` for local use. Never commit `.env`.

### Public — injected into the browser at build time

| Variable | Notes |
|---|---|
| `SUPABASE_URL` | |
| `SUPABASE_ANON_KEY` | Public by design, protected by RLS |
| `LS_CHECKOUT_URL` | Combined checkout (Starter/Growth/Pro) |
| `LS_STARTER_TRIAL_URL` | 48-hour Starter trial |
| `LS_STARTER_STANDARD_URL` | |
| `SUPPORT_EMAIL` | |

### Server-only — never reaches the browser

| Variable | Used by |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | both functions |
| `LEMONSQUEEZY_API_KEY` | customer portal |
| `LEMONSQUEEZY_WEBHOOK_SECRET` | webhook signature check |

### Optional but recommended

`LEMON_STARTER_VARIANT_ID`, `LEMON_GROWTH_VARIANT_ID`, `LEMON_PRO_VARIANT_ID`

Setting these makes plan detection depend on stable variant ids instead of
product names, so renaming a product in Lemon Squeezy can't break billing.
Find them under Products → Variant → ID. Name matching stays as a fallback.

**The build fails deliberately** if `SUPABASE_ANON_KEY` contains a
`service_role` token, or if a server secret is supplied under a public name.

---

## Deployment checklist

1. **Netlify** — connect the repo. Build command `node scripts/build-config.mjs`,
   publish directory `public`, functions directory `netlify/functions`. All of
   this is already in `netlify.toml`.

2. **Supabase → Authentication → URL Configuration** — this one is easy to miss
   and breaks login if skipped. Auth now redirects to `window.location.origin`
   rather than a hard-coded host, so add:
   - Site URL: `https://your-domain.com`
   - Redirect URLs: `https://your-domain.com/app`, `https://your-domain.com/account`,
     `http://localhost:8888/app` for local work, and your Netlify preview domain
     if you use deploy previews.

3. **Google OAuth** — add the same domain to the authorised redirect URIs in the
   Google Cloud console, and confirm the Supabase callback URL is listed.

4. **Lemon Squeezy → Settings → Webhooks** — point at
   `https://your-domain.com/.netlify/functions/lemonsqueezy-webhook` and
   subscribe to the `subscription_*` events. Other events are acknowledged and
   ignored on purpose (see below).

5. **Supabase RLS** — confirm `profiles` and `uploads` restrict rows to
   `auth.uid()`, and that the `files` storage bucket is private. The frontend
   also filters by `user_id` explicitly, but that is defence in depth, not a
   replacement for RLS.

6. **Deploy, then walk the flow**: sign up → trial checkout → upload a CSV →
   download the cleaned file → change plan → cancel → confirm access lasts
   until the period end.

---

## Changes to the original behaviour

Everything the app did still works. These are the deliberate differences.

### Fixed: customer portal exposed other people's billing

`get-customer-portal` accepted any `customerId` from any caller. Lemon Squeezy
customer ids are short sequential integers, so anyone could walk the range and
collect working portal links for other accounts — exposing name, email,
invoices and payment method, and allowing cancellation.

It now requires the caller's Supabase access token, verifies it, and checks the
id against that user's own profile. **The client must send an `Authorization`
header** — `session.js` does this already.

### Fixed: webhook could deactivate paying customers

The webhook processed every event. An `order_created` payload carries
`attributes.status = "paid"`, which fell through the status map to `"inactive"`
— so a successful payment could immediately lock out the subscriber. Only
subscription events are processed now; everything else returns 200 and is
ignored, so Lemon Squeezy stops retrying.

### Fixed: a missing product name wiped the plan

`plan` defaulted to `"none"` whenever the name was absent, overwriting a paying
customer's plan. When the plan can't be resolved the field is now left untouched.

### Fixed: filenames could execute script

Upload history was built with `innerHTML`, so a file named
`<img src=x onerror=...>.csv` ran code in the dashboard. All rendering now uses
`textContent`.

### Changed: authentication redirect

`https://cleanlyai.netlify.app/` is gone. Both flows return to
`window.location.origin`, so the same code works on localhost, deploy previews
and production. `?next=` is honoured only for same-site paths, so it can't be
used as an open redirect.

### Changed: checkout carries identity

Checkout links now pass the signed-in email and Supabase user id as custom data.
The webhook matches on user id first and falls back to email, so a customer who
pays with a different address still gets their plan.

### Changed: marketing copy

The Framer CTA said "No credit card required" while the app said "card
required". That contradiction is a chargeback and consumer-law risk, so the CTA
now reads "Card required. Cancel anytime." **If the trial genuinely doesn't need
a card, change the app copy instead — don't just revert this.**

### Unchanged on purpose

Plan limits, the 14-step upload sequence, `userId/uploadId/original.csv` storage
paths, the `files` bucket, signed-URL downloads, `"contacts - cleaned.csv"`
naming, the monthly usage window, and the rule that a cancelled customer keeps
access until `current_period_end`.

---

## Testing

`npm test` covers the paths where a bug costs money: the cancelled-user grace
period, plan resolution from variant ids, checkout routing per subscription
state, webhook signature verification, event gating, all four plan limits, and
the open-redirect guard.

Verified in a real browser: the dashboard boots and renders plan, usage and
history correctly; a filename containing an XSS payload renders as inert text;
the homepage renders fully with JavaScript disabled.

---

## Known trade-offs

- **Legal pages are templates.** `privacy.html` and `terms.html` are starting
  points and say so. Have a lawyer review them before launch — you process
  personal data belonging to third parties, which is a GDPR processor role.
- **Trusted-by logos** are the company names from the existing Framer site.
  Confirm you have permission to imply these relationships.
- **Google Fonts** is the one remaining third-party request. Self-host Inter if
  you want zero external dependencies or stricter GDPR posture.
