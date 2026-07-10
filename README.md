# HelpScout ↔ ThriveCart Sidebar — Transactions Only

A HelpScout Dynamic Sidebar App that shows a customer's ThriveCart purchase
and subscription history inside a HelpScout conversation. This build is
**scoped to Transactions only**, per explicit instruction: it does not
include ThriveCart Learn, course access, or any grant/revoke functionality.
It is entirely read-only — no writes to ThriveCart, no audit logging.

Based on `ThriveCartHelpScoutSidebarSpec.md`, but with the "Learn" section
(§3.4 Section B, §4.3 automation caveat, §6 edit permissions, §7 audit
logging) removed from scope.

## What it shows

For the customer on the active HelpScout conversation (matched by primary
email only):

- **Individual Purchases** — one-time purchases, most recent first, last 5
  shown with a "Show more" toggle for the rest.
- **Subscriptions** — recurring subscriptions, same last-5-plus-toggle
  pattern, with subscription-specific statuses (active/cancelled/paused/
  past due/trial) instead of purchase statuses (paid/refunded/disputed/
  failed).
- A **"View in ThriveCart"** link to the customer's transactions profile.

States handled: no ThriveCart record found, zero purchases/subscriptions on
file (per group), and API error with a working **Retry** button.

## Architecture

```
HelpScout Conversation
  -> POST /api/helpscout-sidebar   (signed with X-HelpScout-Signature, HMAC-SHA1)
       -> ThriveCart customer lookup by email (read-only)
       -> renders HTML, cached 60s in-memory per email
  -> client-side "Retry" button -> GET /api/retry?token=... (signed short-lived token, bypasses cache)
```

- `api/helpscout-sidebar.js` — the Dynamic App's registered content endpoint.
- `api/retry.js` — same-origin-to-us but cross-origin-to-HelpScout endpoint
  the injected client-side JS calls when the agent clicks Retry.
- `lib/verifyHelpScoutSignature.js` — HMAC-SHA1 signature check against the
  raw request body.
- `lib/parseHelpScoutPayload.js` — pulls the primary email out of the
  HelpScout request.
- `lib/thrivecart.js` — read-only ThriveCart client + field normalization.
- `lib/cache.js` — 60s best-effort in-memory TTL cache keyed by email.
- `lib/renderSidebar.js` — builds the sidebar HTML (styles, rows, toggles).
- `lib/retryToken.js` — signs/verifies the short-lived Retry token.

## Setup

1. `cp .env.example .env.local` and fill in:
   - `HELPSCOUT_APP_SECRET` — from the HelpScout Dynamic App registration.
   - `THRIVECART_API_KEY` — read-scope ThriveCart API key or OAuth token.
   - `RETRY_TOKEN_SECRET` — `openssl rand -hex 32`.
   - `THRIVECART_CUSTOMER_URL_TEMPLATE` — confirm the real profile URL
     pattern in your ThriveCart account (see Open Assumptions below).
2. Deploy to Vercel (new project, or a new route added to the existing
   Flodesk Vercel project) and set the same env vars there.
3. Register the Dynamic App in the HelpScout Developer portal with the
   deployed `/api/helpscout-sidebar` URL as the content endpoint.

## Testing without live credentials

`npm run test:mock` spins up the two API handlers on a local HTTP server and
drives real signed requests through the full pipeline — signature
verification, customer lookup, grouped rendering, empty/no-record/error
states, and the retry round trip — using `THRIVECART_MOCK=true` mock data
instead of the live ThriveCart API. All 6 checks currently pass.

Per the original spec's testing plan (§10), once live ThriveCart credentials
are available, repeat this using **Bryson's own email** as the test
customer before rolling out to Bri and Noemi.

## Open assumptions (confirm before go-live)

These mirror the open questions already flagged in the source spec (§12),
narrowed to what Transactions actually needs:

1. **HelpScout response format.** developer.helpscout.com was unreachable
   (bot-protection 403s) during this build, so the exact "content block"
   schema referenced in early planning notes couldn't be verified live. This
   implementation targets the confirmed legacy Dynamic Apps shape
   `{"html": "<...>"}`, which is well-documented in community references and
   gives full control over layout via plain HTML/CSS/JS. If your app
   registration expects HelpScout's newer structured block format instead,
   `lib/renderSidebar.js` is the only file that needs to change.
2. **HelpScout request payload shape.** `lib/parseHelpScoutPayload.js`
   accepts both a singular `customer.email` and a legacy `customer.emails[]`
   array. Confirm which your registered app actually sends and simplify if
   only one is real.
3. **ThriveCart field names.** ThriveCart's REST reference
   (apidocs.thrivecart.com) was also unreachable during this build. The PHP
   SDK confirms a single `customer(['email' => ...])` call returns purchases
   and subscriptions together; `lib/thrivecart.js` defensively checks several
   plausible field-name variants for product name, amount, and status
   (including refund/dispute) — verify against a real API response and
   tighten `normalizeTransaction()` accordingly.
4. **Profile link URL.** `THRIVECART_CUSTOMER_URL_TEMPLATE` is a guess
   (`https://thrivecart.com/customer/{customerId}`). Confirm the real
   "View in ThriveCart" profile URL pattern in your account.
5. **Rate limits.** ThriveCart's API is rate-limited to 60 requests/minute
   per account (confirmed). The 60-second cache TTL should give ample
   headroom for a small support team, but revisit if usage grows.

## Explicitly out of scope

Per instruction, this build includes **no** ThriveCart Learn functionality:
no course-access list, no grant/revoke controls, no automation warnings, no
"View in ThriveCart Learn" link, and no audit logging (which the original
spec ties only to Learn writes). If Learn support is wanted later, it should
be a second, separate section added on top of this one.
