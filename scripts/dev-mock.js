#!/usr/bin/env node
/**
 * Local end-to-end smoke test: spins up a plain HTTP server hosting the two
 * API handlers exactly as Vercel would invoke them, then drives real signed
 * HelpScout-shaped requests through the full pipeline (signature
 * verification -> ThriveCart lookup [mocked] -> HTML render), including the
 * error + retry round trip. No live ThriveCart or HelpScout credentials
 * needed -- THRIVECART_MOCK=true short-circuits the ThriveCart client.
 *
 * Run: npm run test:mock
 */
process.env.THRIVECART_MOCK = 'true';
process.env.HELPSCOUT_APP_SECRET = process.env.HELPSCOUT_APP_SECRET || 'dev-secret';
process.env.RETRY_TOKEN_SECRET = process.env.RETRY_TOKEN_SECRET || 'dev-retry-secret';

const http = require('http');
const crypto = require('crypto');
const assert = require('assert');

const helpscoutHandler = require('../api/helpscout-sidebar');
const retryHandler = require('../api/retry');

// Vercel's Node runtime augments the plain http.ServerResponse with
// res.status()/res.json() helpers; plain http.createServer doesn't have
// them, so this harness polyfills the subset our handlers use.
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

function signBody(body) {
  return crypto.createHmac('sha1', process.env.HELPSCOUT_APP_SECRET).update(body, 'utf8').digest('base64');
}

function post(port, path, bodyObj, { badSignature = false } = {}) {
  const body = JSON.stringify(bodyObj);
  const signature = badSignature ? 'invalid-signature' : signBody(body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: 'localhost', port, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'X-HelpScout-Signature': signature } },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null }));
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
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

function helpscoutPayload(email) {
  return { customer: { id: 1, email }, ticket: { id: 999 } };
}

async function main() {
  const server = await startServer();
  const port = server.address().port;
  let passed = 0;

  try {
    // 1. Rejects bad signature
    {
      const r = await post(port, '/api/helpscout-sidebar', helpscoutPayload('anyone@example.com'), { badSignature: true });
      assert.strictEqual(r.status, 401, 'bad signature should 401');
      passed++;
    }

    // 2. Customer found -> grouped purchases + subscriptions, most recent first, "show more" present
    {
      const r = await post(port, '/api/helpscout-sidebar', helpscoutPayload('customer@example.com'));
      assert.strictEqual(r.status, 200);
      const html = r.body.html;
      assert.ok(html.includes('Individual Purchases'), 'has Individual Purchases heading');
      assert.ok(html.includes('Subscriptions'), 'has Subscriptions heading');
      assert.ok(html.includes('Piano Foundations Bundle'), 'has a known mock purchase');
      assert.ok(html.includes('Rhythm &amp; Theory Membership'), 'has a known mock subscription');
      assert.ok(html.includes('Show more'), 'shows the show-more toggle beyond 5 purchases');
      assert.ok(html.includes('View in ThriveCart'), 'has profile link');
      assert.ok(!/learn/i.test(html), 'must never mention Learn');
      assert.ok(!/course access|grant|revoke/i.test(html), 'must never mention course-access grant/revoke controls');
      passed++;
    }

    // 3. No record found
    {
      const r = await post(port, '/api/helpscout-sidebar', helpscoutPayload('no-record@example.com'));
      assert.ok(r.body.html.includes('No ThriveCart record found'));
      passed++;
    }

    // 4. Zero purchases/subscriptions -> empty state per group
    {
      const r = await post(port, '/api/helpscout-sidebar', helpscoutPayload('empty@example.com'));
      assert.ok(r.body.html.includes('No individual purchases on file'));
      assert.ok(r.body.html.includes('No subscriptions on file'));
      passed++;
    }

    // 5. API error -> distinct error state with a working retry token, then retry succeeds
    {
      const r = await post(port, '/api/helpscout-sidebar', helpscoutPayload('error@example.com'));
      assert.ok(r.body.html.includes('ThriveCart lookup failed'));
      const tokenMatch = r.body.html.match(/data-retry-token="([^"]+)"/);
      assert.ok(tokenMatch, 'error state includes a retry token');

      // Flip the email's mock behavior isn't possible mid-run, so just confirm
      // the retry endpoint accepts the token and re-runs the pipeline (still
      // errors for this email, deterministically, proving the round trip works).
      const retryRes = await get(port, `/api/retry?token=${encodeURIComponent(tokenMatch[1])}`);
      assert.strictEqual(retryRes.status, 200);
      assert.ok(retryRes.body.html.includes('ThriveCart lookup failed'));
      passed++;
    }

    // 6. Retry rejects invalid tokens
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
