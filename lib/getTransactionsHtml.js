const cache = require('./cache');
const retryToken = require('./retryToken');
const { getCustomerTransactions, ThriveCartError } = require('./thrivecart');
const { renderNoRecord, renderError, renderTransactions } = require('./renderSidebar');

/**
 * Shared lookup + render pipeline used by both the main HelpScout endpoint
 * and the client-side /api/retry endpoint, so the two never drift.
 */
async function getTransactionsHtml(email, { bypassCache = false } = {}) {
  if (!bypassCache) {
    const cached = cache.get(email);
    if (cached) return cached;
  }

  let result;
  try {
    result = await getCustomerTransactions(email);
  } catch (err) {
    if (!(err instanceof ThriveCartError)) throw err;
    let token = null;
    try {
      token = retryToken.sign(email);
    } catch {
      // RETRY_TOKEN_SECRET missing -- render the error without a working Retry button.
    }
    return renderError(token);
  }

  const html = result === null ? renderNoRecord() : renderTransactions({ ...result, email });
  cache.set(email, html);
  return html;
}

module.exports = { getTransactionsHtml };
