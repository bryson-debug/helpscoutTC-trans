/**
 * Splits an incoming HelpScout Dynamic Content GET request's query string
 * into (a) the signature and (b) every other param, in original order --
 * exactly what's needed to both verify the signature and read the context
 * fields (customer-id, conversation-id, etc.).
 */
function parseHelpScoutQuery(url) {
  const parsed = new URL(url, 'http://localhost');
  const orderedParams = {};
  let signature = null;

  for (const [key, value] of parsed.searchParams.entries()) {
    if (key === 'X-HelpScout-Signature') {
      signature = value;
    } else {
      orderedParams[key] = value;
    }
  }

  return {
    signature,
    orderedParams,
    conversationId: orderedParams['conversation-id'] || null,
    customerId: orderedParams['customer-id'] || null,
    mailboxId: orderedParams['mailbox-id'] || null,
  };
}

module.exports = { parseHelpScoutQuery };
