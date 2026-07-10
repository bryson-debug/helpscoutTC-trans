const { readRawBody } = require('../lib/readRawBody');
const { verifyHelpScoutSignature } = require('../lib/verifyHelpScoutSignature');
const { parseHelpScoutPayload } = require('../lib/parseHelpScoutPayload');
const { getTransactionsHtml } = require('../lib/getTransactionsHtml');
const { renderNoRecord } = require('../lib/renderSidebar');

// Disable Vercel's automatic JSON body parsing so we can verify the
// signature against the exact raw bytes HelpScout sent.
module.exports.config = { api: { bodyParser: false } };

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const rawBody = await readRawBody(req);
  const signature = req.headers['x-helpscout-signature'];
  const appSecret = process.env.HELPSCOUT_APP_SECRET;

  if (!verifyHelpScoutSignature(rawBody, signature, appSecret)) {
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }

  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    res.status(400).json({ error: 'Invalid JSON body' });
    return;
  }

  const { primaryEmail } = parseHelpScoutPayload(body);

  if (!primaryEmail) {
    res.status(200).json({ html: renderNoRecord() });
    return;
  }

  const html = await getTransactionsHtml(primaryEmail);
  res.status(200).json({ html });
};
