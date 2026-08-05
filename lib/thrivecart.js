/**
 * Read-only ThriveCart Transactions client.
 *
 * Confirmed against a real `POST /customer` response:
 *   {
 *     "customer": { "name", "email", "ip_address", "address", "custom_fields" },
 *     "purchases": [ { "status", "date", "item_name", "amount", "currency", ... } ],
 *     "subscriptions": [...],
 *     "lifetime_value": { "USD": ... }
 *   }
 *
 * Two things this got wrong before seeing real data: `purchases` and
 * `subscriptions` are top-level siblings of `customer`, not nested inside
 * it; and ThriveCart's customer object has **no id field at all** (no
 * customer.id / customer_id), so existence is checked via `customer.email`
 * instead, and the "View in ThriveCart" link is built from email, not a
 * customer ID. `amount` is in cents (confirmed: 6700 for a $67.00 item).
 * Subscription field names are unconfirmed (this account's test customer had
 * none) but assumed to mirror purchases; adjust if that's wrong.
 *
 * ThriveCart models one-time purchases and recurring subscriptions as
 * distinct things, so the sidebar groups them into two sections: "Individual
 * Purchases" and "Subscriptions".
 *
 * The sidebar's "Lifetime Value" is NOT ThriveCart's own `lifetime_value`
 * field, which is net revenue after refunds (confirmed: $0 for a customer
 * whose only purchases were fully refunded) -- it's computed here instead
 * as the gross sum of every purchase ever made. See computeLifetimeValue().
 */

const { fetchWithTimeout } = require('./fetchWithTimeout');

// Amounts are in cents, matching ThriveCart's real API (confirmed live:
// "amount":6700 for a $67.00 item) -- normalizeTransaction() divides by 100.
const MOCK_PURCHASES = [
  { date: '2026-06-28', product: 'Piano Foundations Bundle', amount: 19700, currency: 'USD', status: 'paid' },
  { date: '2026-04-02', product: 'Piano Foundations Bundle (upsell)', amount: 4700, currency: 'USD', status: 'refunded' },
  { date: '2026-02-19', product: 'Studio Starter Kit', amount: 9700, currency: 'USD', status: 'paid' },
  { date: '2025-12-01', product: 'Holiday Repertoire Pack', amount: 1900, currency: 'USD', status: 'disputed' },
  { date: '2025-09-30', product: 'Studio Starter Kit', amount: 9700, currency: 'USD', status: 'paid' },
  { date: '2025-06-11', product: 'Sight Reading Crash Course', amount: 3900, currency: 'USD', status: 'paid' },
];

const MOCK_SUBSCRIPTIONS = [
  { date: '2026-07-01', product: 'Rhythm & Theory Membership (monthly)', amount: 2700, currency: 'USD', status: 'active' },
  { date: '2026-01-15', product: 'Studio Pro Membership (annual)', amount: 29700, currency: 'USD', status: 'cancelled' },
];

class ThriveCartError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'ThriveCartError';
    this.cause = cause;
  }
}

function isMockMode() {
  return String(process.env.THRIVECART_MOCK).toLowerCase() === 'true';
}

function normalizePurchaseStatus(raw) {
  const s = String(raw || '').toLowerCase();
  if (s.includes('refund')) return 'refunded';
  if (s.includes('dispute') || s.includes('chargeback')) return 'disputed';
  if (s.includes('fail') || s.includes('declin')) return 'failed';
  if (s.includes('paid') || s.includes('complete') || s.includes('success')) return 'paid';
  return s || 'unknown';
}

function normalizeSubscriptionStatus(raw) {
  const s = String(raw || '').toLowerCase();
  if (s.includes('cancel')) return 'cancelled';
  if (s.includes('pause')) return 'paused';
  if (s.includes('past_due') || s.includes('past due') || s.includes('overdue')) return 'past_due';
  if (s.includes('trial')) return 'trial';
  if (s.includes('refund')) return 'refunded';
  if (s.includes('dispute') || s.includes('chargeback')) return 'disputed';
  if (s.includes('active')) return 'active';
  return s || 'unknown';
}

function normalizeTransaction(raw, kind) {
  const date = raw.date || raw.created_at || raw.purchase_date || raw.started_at || raw.timestamp || null;
  const product =
    raw.item_name ||
    (typeof raw.product === 'string' ? raw.product : null) ||
    raw.product_name ||
    (raw.product && raw.product.name) ||
    raw.name ||
    'Unknown product';
  // Confirmed from a real response: amount is in cents (6700 = $67.00).
  const rawAmount = raw.amount ?? raw.total ?? raw.price ?? raw.charge_amount ?? null;
  const amount = rawAmount != null ? Number(rawAmount) / 100 : null;
  const currency = raw.currency || raw.currency_code || 'USD';

  let statusRaw = raw.status || raw.subscription_status;
  if (statusRaw == null) {
    if (kind === 'subscription') {
      if (raw.cancelled || raw.is_cancelled) statusRaw = 'cancelled';
      else if (raw.paused || raw.is_paused) statusRaw = 'paused';
      else statusRaw = 'active';
    } else {
      if (raw.refunded || raw.is_refunded) statusRaw = 'refunded';
      else if (raw.disputed || raw.is_disputed || raw.chargeback) statusRaw = 'disputed';
      else if (raw.failed || raw.is_failed) statusRaw = 'failed';
      else statusRaw = 'paid';
    }
  }

  return {
    date: date ? new Date(date).toISOString() : null,
    product,
    amount,
    currency,
    status: kind === 'subscription' ? normalizeSubscriptionStatus(statusRaw) : normalizePurchaseStatus(statusRaw),
  };
}

function sortByDateDesc(list) {
  return [...list].sort((a, b) => new Date(b.date) - new Date(a.date));
}

// ThriveCart's own `lifetime_value` field is NET revenue after refunds
// (confirmed: it was $0 for a customer whose only two purchases were both
// fully refunded) -- not what's wanted here. This instead sums the gross
// amount of every purchase ever made (excluding "failed" ones, since a
// failed charge was never actually paid), grouped by currency.
function computeLifetimeValue(purchases) {
  const totals = {};
  for (const p of purchases) {
    if (p.status === 'failed' || p.amount == null) continue;
    totals[p.currency] = (totals[p.currency] || 0) + p.amount;
  }
  return Object.entries(totals).map(([currency, amount]) => ({ currency, amount }));
}

async function callThriveCart(method, path, body) {
  const base = process.env.THRIVECART_API_BASE || 'https://thrivecart.com/api/external';
  const apiKey = process.env.THRIVECART_API_KEY;
  if (!apiKey) {
    throw new ThriveCartError('THRIVECART_API_KEY is not configured');
  }

  const url = new URL(path, base.endsWith('/') ? base : `${base}/`);

  let response;
  try {
    response = await fetchWithTimeout(url, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch (err) {
    throw new ThriveCartError('Network error calling ThriveCart API', err);
  }

  // Confirmed live: ThriveCart returns a plain HTTP 404 for a customer
  // email with no record at all, not a 200 with an error key. That's a
  // legitimate "no record" outcome, not a failure -- signal it distinctly
  // so callers don't render it as an error+Retry state.
  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new ThriveCartError(`ThriveCart API returned ${response.status}`);
  }

  let json;
  try {
    json = await response.json();
  } catch (err) {
    throw new ThriveCartError('ThriveCart API returned invalid JSON', err);
  }

  if (json && json.error) {
    throw new ThriveCartError(`ThriveCart API error: ${JSON.stringify(json.error)}`);
  }

  return json;
}

/**
 * Looks up a customer by primary email and returns their normalized
 * purchase and subscription history (each most recent first), plus a
 * customerId for building the "View in ThriveCart" link.
 *
 * Returns `null` if no ThriveCart record exists for this email.
 */
async function getCustomerTransactions(email) {
  if (isMockMode()) {
    if (email === 'error@example.com') throw new ThriveCartError('Simulated ThriveCart API failure');
    if (email === 'no-record@example.com') return null;
    if (email === 'empty@example.com') {
      return { customerId: 'mock-empty', purchases: [], subscriptions: [], lifetimeValue: [] };
    }
    const mockPurchases = sortByDateDesc(MOCK_PURCHASES.map((t) => normalizeTransaction(t, 'purchase')));
    return {
      customerId: 'mock-customer-123',
      purchases: mockPurchases,
      subscriptions: sortByDateDesc(MOCK_SUBSCRIPTIONS.map((t) => normalizeTransaction(t, 'subscription'))),
      lifetimeValue: computeLifetimeValue(mockPurchases),
    };
  }

  // ThriveCart's official SDK calls this as POST /customer with the email
  // in a JSON body, not GET with a query string -- confirmed from the real
  // PHP SDK source after a live GET attempt returned 501.
  const data = await callThriveCart('POST', 'customer', { email });

  // null means ThriveCart returned 404 (no record for this email) --
  // see callThriveCart.
  if (!data) return null;

  // No id/customer_id field exists anywhere in a real response -- confirmed
  // live. Existence is instead determined by whether ThriveCart returned a
  // customer record with an email on it at all.
  const customer = data.customer;
  if (!customer || !customer.email) {
    return null;
  }

  // purchases/subscriptions are top-level siblings of `customer`, not
  // nested inside it -- confirmed live (this got it wrong originally).
  const rawPurchases = data.purchases || [];
  const rawSubscriptions = data.subscriptions || [];

  const purchases = sortByDateDesc(
    rawPurchases.map((t) => normalizeTransaction(t, 'purchase')).filter((t) => t.date)
  );
  const subscriptions = sortByDateDesc(
    rawSubscriptions.map((t) => normalizeTransaction(t, 'subscription')).filter((t) => t.date)
  );

  return {
    // No customer ID exists in ThriveCart's response -- the "View in
    // ThriveCart" link is built from email instead (see renderSidebar.js).
    customerId: null,
    purchases,
    subscriptions,
    lifetimeValue: computeLifetimeValue(purchases),
  };
}

module.exports = { getCustomerTransactions, ThriveCartError };
