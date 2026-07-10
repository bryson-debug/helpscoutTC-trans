const crypto = require('crypto');

/**
 * Verifies the X-HelpScout-Signature header: base64(HMAC-SHA1(appSecret, rawBody)).
 * Must be checked against the raw request body bytes, not a re-serialized JSON
 * object -- re-serializing can reorder/reformat and break the signature match.
 */
function verifyHelpScoutSignature(rawBody, signatureHeader, appSecret) {
  if (!signatureHeader || !appSecret) return false;

  const expected = crypto
    .createHmac('sha1', appSecret)
    .update(rawBody, 'utf8')
    .digest('base64');

  const expectedBuf = Buffer.from(expected, 'utf8');
  const actualBuf = Buffer.from(signatureHeader, 'utf8');

  if (expectedBuf.length !== actualBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}

module.exports = { verifyHelpScoutSignature };
