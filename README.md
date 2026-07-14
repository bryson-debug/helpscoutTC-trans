# HelpScout ↔ ThriveCart Sidebar — Transactions Only

A HelpScout Dynamic Sidebar App that shows a customer's ThriveCart purchase
and subscription history inside a HelpScout conversation. This build is
**scoped to Transactions only**, per explicit instruction: it does not
include ThriveCart Learn course-access data or any grant/revoke
functionality. It is entirely read-only — no writes to ThriveCart, no audit
logging. The one exception is a plain "Learn" link button (added later,
still in scope for a read-only tool) that opens ThriveCart Learn's student
search screen — it makes no API calls and shows no Learn data.

Based on `ThriveCartHelpScoutSidebarSpec.md`, but with the "Learn" section
(§3.4 Section B, §4.3 automation caveat, §6 edit permissions, §7 audit
logging) removed from scope.

## What it shows

For the customer on the active HelpScout conversation (matched by primary
email only):

- **Lifetime Value** — gross total of every purchase the customer has ever
  made (excluding failed charges), grouped by currency. Computed from the
  purchase list ourselves, not ThriveCart's own `lifetime_value` field
  (which is net revenue *after* refunds).
- **Individual Purchases** — one-time purchases, most recent first, last 5
  shown with a "Show more" toggle for the rest. Each section heading is
  also a collapse/expand toggle.
- **Subscriptions** — recurring subscriptions, same last-5-plus-toggle
  pattern, with subscription-specific statuses (active/cancelled/paused/
  past due/trial) instead of purchase statuses (paid/refunded/disputed/
  failed).
- A **"Transactions"** link to the customer's ThriveCart transactions
  profile, and a **"Learn"** link to the ThriveCart Learn student search
  screen (see "Explicitly out of scope" below for why it's a plain link,
  not pre-filled or a direct one-click profile link).

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

The response is raw **`text/html`**, not a JSON envelope. A `{"html":
"..."}` JSON response (the legacy Dynamic App shape) rendered in the
sidebar as a raw "Pretty-print" JSON debug viewer instead of actual content
-- a strong signal HelpScout didn't recognize that shape as valid content
for this protocol. `api/helpscout-sidebar.js` now responds with
`Content-Type: text/html` and the HTML directly -- confirmed working live,
the sidebar renders real content correctly.

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

## Confirmed against live requests during setup

Both of these were guessed initially (docs sites 403'd every fetch attempt)
and corrected once a real conversation exercised the endpoint:

- **HelpScout signature algorithm**: `base64(HMAC-SHA1(secret,
  JSON.stringify(orderedParamsExcludingSignature)))`, params kept in their
  original query-string order — verified working (`signatureValid: true`
  against a live request).
- **ThriveCart customer lookup**: `POST /customer` with `{ "email": ... }`
  as a JSON body (a GET with a query string returns 501). Response shape:
  ```json
  {
    "customer": { "name", "email", "ip_address", "address", "custom_fields" },
    "purchases": [ { "status", "date", "item_name", "amount", "currency", "refunds", ... } ],
    "subscriptions": [...],
    "lifetime_value": { "USD": ... }
  }
  ```
  Two non-obvious things this got wrong before seeing real data: `purchases`
  and `subscriptions` are top-level siblings of `customer`, not nested
  inside it; and **ThriveCart's customer object has no id field at all** —
  existence is checked via `customer.email`. `amount` is in cents.
- **Response format**: raw `text/html`, not a JSON envelope — a `{"html":
  "..."}` response rendered in the sidebar as a raw JSON debug viewer
  instead of actual content.
- **"Transactions" profile link**: confirmed live —
  `https://thrivecart.com/{accountSlug}/#/orders/view/{base64(email)}/live/overview`.
  Since ThriveCart's API returns no customer ID, the URL's id segment turned
  out to just be the customer's email, base64-encoded. `THRIVECART_ACCOUNT_SLUG`
  is your account's dashboard slug (e.g. `thatmusicteacher`).

## Remaining open assumptions (confirm before go-live)

1. **~~"Customer not found" behavior~~ -- confirmed live.** ThriveCart
   returns a plain HTTP 404 for an email with no record at all (not a 200
   with an error key, as guessed). `callThriveCart` now treats 404
   specifically as "no record" (returns `null`) rather than throwing; any
   other non-2xx status still throws and renders the error+Retry state.
2. **Subscription field names are unconfirmed.** The live test customer had
   an empty `subscriptions` array, so `normalizeTransaction()`'s handling of
   subscriptions (assumed to mirror purchases' field names, plus a guessed
   active/cancelled/paused/past_due/trial status vocabulary) has never been
   exercised against a real subscription object. Test with a customer who
   has an active subscription and adjust if the fields don't match.
3. **Lifetime Value scope.** `computeLifetimeValue()` currently sums only
   one-time purchases (`purchases`), not subscription payments
   (`subscriptions`) -- a customer with an active subscription but no
   one-time purchases would show $0 here even though they've paid ThriveCart
   money. Revisit if subscription revenue should count toward this total.
4. **Which email is "primary".** HelpScout's customer resource doesn't
   expose an explicit "primary" flag in every API version; `getCustomerEmail`
   in `lib/helpscoutApi.js` currently takes the first email on the customer
   record. Verify against a real customer that has multiple emails on file.
5. **Rate limits.** ThriveCart's API is rate-limited to 60 requests/minute
   per account (confirmed). The 60-second cache TTL should give ample
   headroom for a small support team, but revisit if usage grows.

Two temporary diagnostic `console.log` calls are still in the code
(`api/helpscout-sidebar.js` for the signature comparison,
`lib/getTransactionsHtml.js` for ThriveCart error details) — safe to remove
once you've run live with real customers for a few days without surprises.

## Explicitly out of scope

Per instruction, this build includes **no** ThriveCart Learn course-access
functionality: no course-access list, no grant/revoke controls, no
automation warnings, and no audit logging (which the original spec ties
only to Learn writes). The one Learn-related addition is the plain "Learn"
link button, added later as a small, explicitly-scoped exception — it's
just a navigation link, makes no ThriveCart Learn API calls, and shows no
course-access data.

That link goes to the plain **student search screen**, with no email
pre-filled and no direct one-click profile -- confirmed against ThriveCart's
own official API reference that the only student-related endpoint is
"Create new student" (a write/enrollment action requiring email + course_id,
with side effects like a signin/welcome email), so there's no safe
read-only way to resolve an email to a student ID or build a direct link.
A `?search={email}` pre-filled version was also tried, but ThriveCart's own
Learn search applied it inconsistently on live testing (worked once, then
failed identically via link-click and reload, with no reliable fix
available from our side) -- so the agent enters the email themselves
instead. If ThriveCart ever adds a genuine read-only Learn lookup endpoint,
this could become a reliable direct link.

If full Learn support (course-access display, grant/revoke) is wanted
later, it should be a second, separate section added on top of this one.
