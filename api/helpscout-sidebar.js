const { parseHelpScoutQuery } = require('../lib/parseHelpScoutQuery');
const { verifyHelpScoutQuerySignature } = require('../lib/verifyHelpScoutQuerySignature');
const { getCustomerEmail, HelpScoutApiError } = require('../lib/helpscoutApi');
const { getTransactionsHtml } = require('../lib/getTransactionsHtml');
const { renderError } = require('../lib/renderSidebar');

/**
 * HelpScout's Dynamic Content callback: a GET request with all context
 * (conversation-id, customer-id, mailbox-id, user-id, installation-ids,
 * application-id, application-slug) as query parameters, plus the request's
 * own signature as an `X-HelpScout-Signature` query parameter -- confirmed
 * against a live request; see README "Open Assumptions" for the signature
 * algorithm details, which could not be verified against live docs (403s).
 *
 * No email is included in the request, only HelpScout's internal
 * customer-id, so we resolve that to an email via the HelpScout Mailbox API
 * before we can look anything up in ThriveCart.
 */
module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    console.log('helpscout-sidebar: non-GET request', { method: req.method, url: req.url });
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { signature, orderedParams, customerId } = parseHelpScoutQuery(req.url);
  const appSecret = process.env.HELPSCOUT_APP_SECRET;
  const signatureValid = verifyHelpScoutQuerySignature(orderedParams, signature, appSecret);

  // Temporary diagnostic: confirms whether our inferred signature algorithm
  // (HMAC-SHA1 of JSON-encoded ordered params, base64) actually matches what
  // HelpScout sends -- remove once a live request has verified successfully.
  console.log('helpscout-sidebar request:', { orderedParams, receivedSignature: signature, signatureValid });

  if (!signatureValid) {
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }

  if (!customerId) {
    res.status(400).json({ error: 'Missing customer-id' });
    return;
  }

  let email;
  try {
    email = await getCustomerEmail(customerId);
  } catch (err) {
    if (!(err instanceof HelpScoutApiError)) throw err;
    res.status(200).json({ html: renderError(null, 'Could not load customer info from HelpScout') });
    return;
  }

  if (!email) {
    res.status(200).json({ html: renderError(null, 'Could not load customer info from HelpScout') });
    return;
  }

  const html = await getTransactionsHtml(email);
  res.status(200).json({ html });
};
