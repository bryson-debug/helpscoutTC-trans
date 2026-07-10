const retryToken = require('../lib/retryToken');
const { getTransactionsHtml } = require('../lib/getTransactionsHtml');

/**
 * Called by client-side JS from inside the rendered sidebar (running in
 * HelpScout's iframe origin, not ours) when the agent clicks "Retry" after
 * an error. Auth is a short-lived signed token minted at render time, not a
 * HelpScout signature -- HelpScout never calls this endpoint itself.
 */
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const url = new URL(req.url, 'http://localhost');
  const token = url.searchParams.get('token');
  const verified = retryToken.verify(token);

  if (!verified) {
    res.status(401).json({ error: 'Invalid or expired retry token' });
    return;
  }

  const html = await getTransactionsHtml(verified.email, { bypassCache: true });
  res.status(200).json({ html });
};
