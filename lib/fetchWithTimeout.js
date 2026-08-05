/**
 * fetch() has no built-in timeout -- a hung/slow external call (ThriveCart,
 * HelpScout's OAuth token endpoint, HelpScout's Mailbox API) would otherwise
 * block until Vercel's own function-duration limit kills the whole
 * invocation, surfacing as a raw platform 504 page inside the HelpScout
 * sidebar instead of our normal error+Retry state. This aborts and throws
 * a plain Error well before that, so callers can catch it and render
 * something useful.
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`Request to ${url} timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { fetchWithTimeout };
