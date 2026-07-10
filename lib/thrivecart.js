/**
 * Read-only ThriveCart Transactions client.
 *
 * ThriveCart's official PHP SDK loads a customer (details + purchases +
 * subscriptions) via a single call: $tc->customer(['email' => '...']). We
 * could not reach the live REST reference (apidocs.thrivecart.com) at build
 * time to confirm exact JSON field names for purchase/subscription status
 * (paid/refunded/disputed/failed, active/cancelled/paused), so
 * `normalizeTransaction()` below checks several plausible field-name
 * variants and is the single place to adjust once real API responses are
 * available. See README "Open Assumptions".
 *
 * ThriveCart models one-time purchases and recurring subscriptions as
 * distinct things, so the sidebar groups them into two sections: "Individual
 * Purchases" and "Subscriptions".
 */

const MOCK_PURCHASES = [
  { date: '2026-06-28', product: 'Piano Foundations Bundle', amount: 197.0, currency: 'USD', status: 'paid' },
  { date: '2026-04-02', product: 'Piano Foundations Bundle (upsell)', amount: 47.0, currency: 'USD', status: 'refunded' },
  { date: '2026-02-19', product: 'Studio Starter Kit', amount: 97.0, currency: 'USD', status: 'paid' },
  { date: '2025-12-01', product: 'Holiday Repertoire Pack', amount: 19.0, currency: 'USD', status: 'disputed' },
  { date: '2025-09-30', product: 'Studio Starter Kit', amount: 97.0, currency: 'USD', status: 'paid' },
  { date: '2025-06-11', product: 'Sight Reading Crash Course', amount: 39.0, currency: 'USD', status: 'paid' },
];

const MOCK_SUBSCRIPTIONS = [
  { date: '2026-07-01', product: 'Rhythm & Theory Membership (monthly)', amount: 27.0, currency: 'USD', status: 'active' },
  { date: '2026-01-15', product: 'Studio Pro Membership (annual)', amount: 297.0, currency: 'USD', status: 'cancelled' },
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
    (typeof raw.product === 'string' ? raw.product : null) ||
    raw.product_name ||
    (raw.product && raw.product.name) ||
    raw.item_name ||
    raw.name ||
    'Unknown product';
  const amount = raw.amount ?? raw.total ?? raw.price ?? raw.charge_amount ?? null;
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
    amount: amount != null ? Number(amount) : null,
    currency,
    status: kind === 'subscription' ? normalizeSubscriptionStatus(statusRaw) : normalizePurchaseStatus(statusRaw),
  };
}

function sortByDateDesc(list) {
  return [...list].sort((a, b) => new Date(b.date) - new Date(a.date));
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
    response = await fetch(url, {
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
      return { customerId: 'mock-empty', purchases: [], subscriptions: [] };
    }
    return {
      customerId: 'mock-customer-123',
      purchases: sortByDateDesc(MOCK_PURCHASES.map((t) => normalizeTransaction(t, 'purchase'))),
      subscriptions: sortByDateDesc(MOCK_SUBSCRIPTIONS.map((t) => normalizeTransaction(t, 'subscription'))),
    };
  }

  // ThriveCart's official SDK calls this as POST /customer with the email
  // in a JSON body, not GET with a query string -- confirmed from the real
  // PHP SDK source after a live GET attempt returned 501.
  const data = await callThriveCart('POST', 'customer', { email });

  // Temporary diagnostic: log the raw shape once so normalizeTransaction's
  // guessed field names can be corrected against a real response. Remove
  // once purchases/subscriptions render correctly from live data.
  console.log('ThriveCart raw customer response:', JSON.stringify(data));

  const customer = data.customer || data;
  if (!customer || (!customer.id && !customer.customer_id)) {
    return null;
  }

  const rawPurchases = customer.purchases || customer.orders || customer.transactions || [];
  const rawSubscriptions = customer.subscriptions || customer.recurring || [];

  const purchases = sortByDateDesc(
    rawPurchases.map((t) => normalizeTransaction(t, 'purchase')).filter((t) => t.date)
  );
  const subscriptions = sortByDateDesc(
    rawSubscriptions.map((t) => normalizeTransaction(t, 'subscription')).filter((t) => t.date)
  );

  return {
    customerId: customer.id || customer.customer_id,
    purchases,
    subscriptions,
  };
}

module.exports = { getCustomerTransactions, ThriveCartError };
