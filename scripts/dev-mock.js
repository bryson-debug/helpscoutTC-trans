#!/usr/bin/env node
/**
 * Local end-to-end smoke test: spins up a plain HTTP server hosting the two
 * API handlers exactly as Vercel would invoke them, then drives real
 * HelpScout-shaped GET requests (query-param signature, customer-id only --
 * the actual confirmed live protocol, not the originally-assumed POST/JSON
 * body one) through the full pipeline: signature verification -> HelpScout
 * customer-id-to-email resolution [mocked] -> ThriveCart lookup [mocked] ->
 * HTML render, including the error + retry round trip.
 *
 * THRIVECART_MOCK=true and HELPSCOUT_MOCK=true short-circuit both external
 * APIs, so no live credentials are needed to run this.
 *
 * Run: npm run test:mock
 */
process.env.THRIVECART_MOCK = 'true';
process.env.HELPSCOUT_MOCK = 'true';
process.env.HELPSCOUT_APP_SECRET = process.env.HELPSCOUT_APP_SECRET || 'dev-secret';
process.env.RETRY_TOKEN_SECRET = process.env.RETRY_TOKEN_SECRET || 'dev-retry-secret';

const http = require('http');
const crypto = require('crypto');
const assert = require('assert');

const helpscoutHandler = require('../api/helpscout-sidebar');
const retryHandler = require('../api/retry');

function withVercelResHelpers(res) {
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(payload));
    return res;
  };
  return res;
}

function startServer() {
  const server = http.createServer((req, res) => {
    withVercelResHelpers(res);
    const handler = req.url.startsWith('/api/retry') ? retryHandler : helpscoutHandler;
    Promise.resolve(handler(req, res)).catch((err) => {
      console.error('Handler threw:', err);
      if (!res.headersSent) res.writeHead(500);
      res.end(JSON.stringify({ error: 'internal' }));
    });
  });
  return new Promise((resolve) => server.listen(0, () => resolve(server)));
}

// Mirrors lib/verifyHelpScoutQuerySignature.js: HMAC-SHA1 of the
// JSON-encoded params (in order, signature excluded), base64-encoded.
function signParams(orderedParams) {
  const json = JSON.stringify(orderedParams);
  return crypto.createHmac('sha1', process.env.HELPSCOUT_APP_SECRET).update(json, 'utf8').digest('base64');
}

function buildHelpScoutUrl(customerId, { badSignature = false } = {}) {
  const orderedParams = {
    'conversation-id': '3382942562',
    'conversation-number': '6002',
    'customer-id': customerId,
    'mailbox-id': '364558',
    'user-id': '772569',
    'installation-ids': 'XGao7GBKoDV5',
    'application-id': '5Ma3boWZmlnA',
    'application-slug': '167604-thrivecart-transactions',
  };
  const signature = badSignature ? 'invalid-signature' : signParams(orderedParams);
  const qs = new URLSearchParams({ ...orderedParams, 'X-HelpScout-Signature': signature });
  return `/api/helpscout-sidebar?${qs.toString()}`;
}

function get(port, path) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: 'localhost', port, path }, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null }));
      })
      .on('error', reject);
  });
}

async function main() {
  const server = await startServer();
  const port = server.address().port;
  let passed = 0;

  try {
    // 1. Rejects bad signature
    {
      const r = await get(port, buildHelpScoutUrl('1', { badSignature: true }));
      assert.strictEqual(r.status, 401, 'bad signature should 401');
      passed++;
    }

    // 2. Customer found -> grouped purchases + subscriptions
    {
      const r = await get(port, buildHelpScoutUrl('706401868'));
      assert.strictEqual(r.status, 200);
      const html = r.body.html;
      assert.ok(html.includes('Individual Purchases'));
      assert.ok(html.includes('Subscriptions'));
      assert.ok(html.includes('Piano Foundations Bundle'));
      assert.ok(html.includes('Rhythm &amp; Theory Membership'));
      assert.ok(html.includes('Show more'));
      assert.ok(html.includes('View in ThriveCart'));
      assert.ok(!/learn/i.test(html), 'must never mention Learn');
      assert.ok(!/course access|grant|revoke/i.test(html), 'must never mention course-access grant/revoke controls');
      passed++;
    }

    // 3. HelpScout customer has no email on file -> distinct internal error, no retry
    {
      const r = await get(port, buildHelpScoutUrl('no-email'));
      assert.ok(r.body.html.includes('Could not load customer info from HelpScout'));
      assert.ok(!r.body.html.includes('data-retry-token="'), 'no ThriveCart retry token when email resolution itself failed');
      passed++;
    }

    // 4. Missing customer-id entirely -> 400
    {
      const badQs = new URLSearchParams({ 'conversation-id': '1' });
      const sig = signParams({ 'conversation-id': '1' });
      badQs.set('X-HelpScout-Signature', sig);
      const r = await get(port, `/api/helpscout-sidebar?${badQs.toString()}`);
      assert.strictEqual(r.status, 400);
      passed++;
    }

    // 5. Retry rejects invalid tokens
    {
      const r = await get(port, '/api/retry?token=garbage');
      assert.strictEqual(r.status, 401);
      passed++;
    }

    console.log(`\n✅ All ${passed} mock pipeline checks passed.`);
  } finally {
    server.close();
  }
}

main().catch((err) => {
  console.error('\n❌ Mock pipeline test failed:', err);
  process.exit(1);
});
