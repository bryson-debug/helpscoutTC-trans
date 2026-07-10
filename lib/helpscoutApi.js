/**
 * HelpScout Mailbox API v2 client -- used only to resolve the `customer-id`
 * HelpScout sends in the Dynamic Content request into an actual email
 * address, since the request itself doesn't include one (confirmed against
 * a live request; see README "Open Assumptions"). Read-only: fetches a
 * customer record, nothing is written back to HelpScout.
 *
 * Requires a separate OAuth2 "My App" registered in HelpScout (Client
 * Credentials grant) -- NOT the same thing as the Dynamic Content app's
 * "Content signature key". See README setup steps.
 */

let cachedToken = null; // { accessToken, expiresAt }

function isMockMode() {
  return String(process.env.HELPSCOUT_MOCK).toLowerCase() === 'true';
}

class HelpScoutApiError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'HelpScoutApiError';
    this.cause = cause;
  }
}

async function getAccessToken() {
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.accessToken;
  }

  const clientId = process.env.HELPSCOUT_OAUTH_CLIENT_ID;
  const clientSecret = process.env.HELPSCOUT_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new HelpScoutApiError('HELPSCOUT_OAUTH_CLIENT_ID/SECRET are not configured');
  }

  let response;
  try {
    response = await fetch('https://api.helpscout.net/v2/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });
  } catch (err) {
    throw new HelpScoutApiError('Network error fetching HelpScout OAuth token', err);
  }

  if (!response.ok) {
    throw new HelpScoutApiError(`HelpScout OAuth token request returned ${response.status}`);
  }

  const json = await response.json();
  const ttlMs = (json.expires_in || 7200) * 1000;
  cachedToken = { accessToken: json.access_token, expiresAt: Date.now() + ttlMs - 60_000 };
  return cachedToken.accessToken;
}

/**
 * Returns the customer's primary email, or null if the customer has no
 * email on file. HelpScout's Customer resource doesn't expose an explicit
 * "primary" flag on emails in all API versions -- we take the first entry,
 * consistent with the spec's "primary email only" requirement. Verify this
 * against a real customer record; adjust here if HelpScout does mark one
 * email as primary in your account's API responses.
 */
async function getCustomerEmail(customerId) {
  if (isMockMode()) {
    if (customerId === 'no-email') return null;
    return 'customer@example.com';
  }

  const token = await getAccessToken();

  let response;
  try {
    response = await fetch(`https://api.helpscout.net/v2/customers/${encodeURIComponent(customerId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (err) {
    throw new HelpScoutApiError('Network error fetching HelpScout customer', err);
  }

  if (!response.ok) {
    throw new HelpScoutApiError(`HelpScout customer lookup returned ${response.status}`);
  }

  const json = await response.json();
  const emails = (json._embedded && json._embedded.emails) || json.emails || [];
  if (!emails.length) return null;

  const email = emails[0].value || emails[0].email || (typeof emails[0] === 'string' ? emails[0] : null);
  return email ? email.trim().toLowerCase() : null;
}

module.exports = { getCustomerEmail, HelpScoutApiError };
