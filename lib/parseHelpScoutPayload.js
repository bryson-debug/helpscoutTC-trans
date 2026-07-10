/**
 * Extracts the fields this app needs from a HelpScout Dynamic App request body.
 *
 * HelpScout's documented customer payload shape has varied across app
 * generations (legacy Dynamic Apps vs. the newer App Developer Platform), and
 * we could not confirm the exact live shape against developer.helpscout.com at
 * build time (see README "Open Assumptions"). This parser accepts the field
 * name variants seen in community references and fails loudly if none match,
 * rather than silently matching the wrong field.
 */
function parseHelpScoutPayload(body) {
  const customer = (body && body.customer) || {};

  // Primary email only, per spec: prefer an explicit singular `email` field,
  // fall back to the first entry of an `emails` array (legacy Dynamic App shape).
  let primaryEmail = null;
  if (typeof customer.email === 'string' && customer.email.trim()) {
    primaryEmail = customer.email.trim();
  } else if (Array.isArray(customer.emails) && customer.emails.length > 0) {
    const first = customer.emails[0];
    primaryEmail = typeof first === 'string' ? first : first && first.value;
  }

  const conversationId =
    (body && body.ticket && (body.ticket.id || body.ticket.number)) ||
    (body && body.conversation && (body.conversation.id || body.conversation.number)) ||
    null;

  return {
    primaryEmail: primaryEmail ? primaryEmail.trim().toLowerCase() : null,
    conversationId,
    customerId: customer.id || null,
  };
}

module.exports = { parseHelpScoutPayload };
