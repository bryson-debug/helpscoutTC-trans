const crypto = require('crypto');

/**
 * HelpScout's actual Dynamic Content protocol (confirmed against a live
 * request -- not the legacy POST/JSON-body format originally assumed) sends
 * a GET request with all context as query parameters, including the
 * signature itself as an `X-HelpScout-Signature` query param:
 *
 *   ?conversation-id=...&conversation-number=...&customer-id=...&
 *    mailbox-id=...&user-id=...&installation-ids=...&application-id=...&
 *    application-slug=...&X-HelpScout-Signature=...
 *
 * Per HelpScout's signature validation guide: take every query parameter
 * *except* the signature itself (and except any params that were part of
 * your own registered callback URL, none here), JSON-encode them preserving
 * their original order, then:
 *
 *   base64(HMAC-SHA1(secret, JSON.stringify(remainingParamsInOrder)))
 *
 * `orderedParams` must be a plain object built by iterating the original
 * query string in order (insertion order on string keys is preserved by JS
 * objects), with the signature key already removed -- see
 * lib/parseHelpScoutQuery.js.
 */
function verifyHelpScoutQuerySignature(orderedParams, signature, appSecret) {
  if (!signature || !appSecret) return false;

  const json = JSON.stringify(orderedParams);
  const expected = crypto.createHmac('sha1', appSecret).update(json, 'utf8').digest('base64');

  const expectedBuf = Buffer.from(expected, 'utf8');
  const actualBuf = Buffer.from(signature, 'utf8');

  if (expectedBuf.length !== actualBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}

module.exports = { verifyHelpScoutQuerySignature };
