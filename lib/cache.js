/**
 * Short-term in-memory TTL cache, keyed by primary email.
 *
 * Best-effort only: Vercel serverless functions don't guarantee a warm,
 * shared instance between invocations, so this cache helps on warm reuse
 * but is not a substitute for correctness (matches the Flodesk integration's
 * documented caching pattern -- see README).
 */

const DEFAULT_TTL_MS = 60 * 1000;
const store = new Map();

function get(key) {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return undefined;
  }
  return entry.value;
}

function set(key, value, ttlMs = DEFAULT_TTL_MS) {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

function invalidate(key) {
  store.delete(key);
}

module.exports = { get, set, invalidate, DEFAULT_TTL_MS };
