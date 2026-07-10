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
  -> GET /api/helpscout-sidebar?conversation-id=...&customer-id=...&...&X-HelpScout-Signature=...
       -> verify signature (HMAC-SHA1 of the other query params, base64)
       -> resolve customer-id to an email via HelpScout Mailbox API (OAuth2)
       -> ThriveCart customer lookup by that email (read-only)
       -> renders HTML, cached 60s in-memory per email
  -> client-side "Retry" button -> GET /api/retry?token=... (signed short-lived token, bypasses cache)
```

Confirmed against a live request during setup: HelpScout's actual Dynamic
Content protocol is a **GET** request with everything as **query
parameters**, including the signature itself (`X-HelpScout-Signature` as a
query param, not a header) -- not the POST-with-JSON-body legacy format
originally assumed from community references. Critically, **no email is
included** -- only HelpScout's internal `customer-id` -- so this app makes
one additional read-only call to HelpScout's own Mailbox API to resolve
that ID to an email before it can look anything up in ThriveCart.

- `api/helpscout-sidebar.js` — the Dynamic Content app's registered
  callback endpoint.
- `api/retry.js` — same-origin-to-us but cross-origin-to-HelpScout endpoint
  the injected client-side JS calls when the agent clicks Retry.
- `lib/parseHelpScoutQuery.js` — splits the incoming query string into the
  signature and the ordered context params (customer-id, conversation-id, …).
- `lib/verifyHelpScoutQuerySignature.js` — HMAC-SHA1 signature check over
  the JSON-encoded, ordered query params.
- `lib/helpscoutApi.js` — HelpScout Mailbox API client (OAuth2 client
  credentials) that resolves `customer-id` -> primary email.
- `lib/thrivecart.js` — read-only ThriveCart client + field normalization.
- `lib/cache.js` — 60s best-effort in-memory TTL cache keyed by email.
- `lib/renderSidebar.js` — builds the sidebar HTML (styles, rows, toggles).
- `lib/retryToken.js` — signs/verifies the short-lived Retry token.

## Setup

1. `cp .env.example .env.local` and fill in:
   - `HELPSCOUT_APP_SECRET` — the "Content signature key" from the HelpScout
     Dynamic Content app registration.
   - `HELPSCOUT_OAUTH_CLIENT_ID` / `HELPSCOUT_OAUTH_CLIENT_SECRET` — from a
     **separate** OAuth2 "My App" registered under your HelpScout profile
     (Client Credentials grant), used only to call the Mailbox API and
     resolve a customer-id to an email. This is not the same credential as
     `HELPSCOUT_APP_SECRET`.
   - `THRIVECART_API_KEY` — read-scope ThriveCart API key or OAuth token.
   - `RETRY_TOKEN_SECRET` — `openssl rand -hex 32`.
   - `THRIVECART_CUSTOMER_URL_TEMPLATE` — confirm the real profile URL
     pattern in your ThriveCart account (see Open Assumptions below).
2. Deploy to Vercel and set the same env vars there.
3. Register the Dynamic Content app in the HelpScout Developer portal with
   the deployed `/api/helpscout-sidebar` URL as the Content URL, and enable
   it on the mailbox(es) you want it visible in.

## Testing without live credentials

`npm run test:mock` spins up the two API handlers on a local HTTP server and
drives real HelpScout-shaped GET requests through the full pipeline —
signature verification, customer-id-to-email resolution, ThriveCart lookup,
grouped rendering, empty/no-record/error states, and the retry round trip —
using `THRIVECART_MOCK=true` and `HELPSCOUT_MOCK=true` instead of the live
APIs. All 5 checks currently pass.

Per the original spec's testing plan (§10), once live credentials are
available, repeat this using **Bryson's own email** as the test customer
before rolling out to Bri and Noemi.

## Open assumptions (confirm before go-live)

1. **Signature algorithm.** developer.helpscout.com returned 403s
   (bot-protection) for every direct fetch attempt during this build, so the
   exact canonicalization couldn't be read verbatim from the source. Based on
   corroborating search-engine excerpts of HelpScout's own signature
   validation guide and SDK source, the implemented algorithm is:
   `base64(HMAC-SHA1(secret, JSON.stringify(orderedParamsExcludingSignature)))`,
   with params kept in their original query-string order. **This is the one
   thing most likely to still be wrong** — if requests still 401 in a live
   conversation, check the temporary diagnostic log in
   `api/helpscout-sidebar.js` (logs the received signature and our computed
   comparison) and adjust `lib/verifyHelpScoutQuerySignature.js` /
   `lib/parseHelpScoutQuery.js` accordingly. Remove that logging once a real
   request verifies successfully.
2. **Which email is "primary".** HelpScout's customer resource doesn't
   expose an explicit "primary" flag in every API version; `getCustomerEmail`
   in `lib/helpscoutApi.js` currently takes the first email on the customer
   record. Verify against a real customer that has multiple emails on file.
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
