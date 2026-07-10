const crypto = require('crypto');

/**
 * Short-lived signed token embedding the customer email, so the client-side
 * "Retry" button (running inside HelpScout's iframe) can ask our own
 * /api/retry endpoint for fresh data without re-deriving a HelpScout
 * signature -- that signature is only ever sent by HelpScout itself.
 *
 * Format: base64url(email:expiresAtMs).base64url(HMAC-SHA256 signature)
 */

const DEFAULT_TTL_MS = 5 * 60 * 1000;

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

function sign(email, ttlMs = DEFAULT_TTL_MS) {
  const secret = process.env.RETRY_TOKEN_SECRET;
  if (!secret) throw new Error('RETRY_TOKEN_SECRET is not configured');

  const payload = `${email}:${Date.now() + ttlMs}`;
  const payloadB64 = b64url(payload);
  const signature = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
  return `${payloadB64}.${signature}`;
}

function verify(token) {
  const secret = process.env.RETRY_TOKEN_SECRET;
  if (!secret || !token || typeof token !== 'string') return null;

  const [payloadB64, signature] = token.split('.');
  if (!payloadB64 || !signature) return null;

  const expectedSignature = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
  const sigBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expectedSignature);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  const [email, expiresAtStr] = Buffer.from(payloadB64, 'base64url').toString('utf8').split(':');
  const expiresAt = Number(expiresAtStr);
  if (!email || !expiresAt || Date.now() > expiresAt) return null;

  return { email };
}

module.exports = { sign, verify };
