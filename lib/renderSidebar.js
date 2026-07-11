/**
 * Renders the HelpScout Dynamic App sidebar HTML for the ThriveCart
 * Transactions section (read-only). No Learn/course-access content is
 * included anywhere in this app, by design.
 *
 * We target the legacy Dynamic Apps response shape `{ "html": "<...>" }`
 * (confirmed via community references; the "content block" schema mentioned
 * in early planning notes could not be verified against live HelpScout docs
 * at build time -- see README "Open Assumptions"). Using raw HTML/CSS/JS
 * gives us full control over layout and lets "show more" and "Retry" work
 * as plain client-side interactions with no server round trip needed for
 * the initial 5-vs-all toggle.
 */

const VISIBLE_COUNT = 5;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatAmount(amount, currency) {
  if (amount == null || Number.isNaN(Number(amount))) return '—';
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(amount);
  } catch {
    return `$${Number(amount).toFixed(2)}`;
  }
}

const STATUS_LABELS = {
  paid: 'Paid',
  refunded: 'Refunded',
  disputed: 'Disputed',
  failed: 'Failed',
  active: 'Active',
  cancelled: 'Cancelled',
  paused: 'Paused',
  past_due: 'Past due',
  trial: 'Trial',
  unknown: 'Unknown',
};

function statusBadge(status) {
  const label = STATUS_LABELS[status] || escapeHtml(status);
  return `<span class="tc-badge tc-badge--${escapeHtml(status)}">${label}</span>`;
}

function baseStyles() {
  return `
    <style>
      .tc-sidebar { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; font-size: 13px; color: #1a1a1a; }
      .tc-ltv { display: flex; justify-content: space-between; align-items: baseline; padding-bottom: 6px; margin-bottom: 2px; border-bottom: 1px solid #eceef1; }
      .tc-ltv-label { font-size: 12px; font-weight: 600; color: #55575c; text-transform: uppercase; letter-spacing: 0.02em; }
      .tc-ltv-amount { display: inline-block; font-size: 13px; font-weight: 700; background: #e3f5e9; color: #1c7a3f; padding: 2px 9px; border-radius: 999px; }
      .tc-subheading { font-size: 12px; font-weight: 600; color: #55575c; text-transform: uppercase; letter-spacing: 0.02em; }
      .tc-group-header { display: flex; align-items: center; justify-content: space-between; width: 100%; background: none; border: none; padding: 0; margin: 8px 0 3px; cursor: pointer; text-align: left; }
      .tc-group-header:first-child { margin-top: 0; }
      .tc-group-arrow { font-size: 10px; color: #767980; width: 10px; }
      .tc-row { display: flex; justify-content: space-between; gap: 8px; padding: 3px 0; border-bottom: 1px solid #eceef1; line-height: 1.25; }
      .tc-row:last-child { border-bottom: none; }
      .tc-row-main { display: flex; flex-direction: column; min-width: 0; }
      .tc-row-product { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .tc-row-date { color: #767980; font-size: 11px; }
      .tc-row-side { display: flex; flex-direction: column; align-items: flex-end; gap: 1px; flex-shrink: 0; }
      .tc-row-amount { font-weight: 500; }
      .tc-badge { font-size: 10px; font-weight: 600; padding: 0 5px; border-radius: 10px; display: inline-block; line-height: 1.5; }
      .tc-badge--paid, .tc-badge--active { background: #e3f5e9; color: #1c7a3f; }
      .tc-badge--refunded, .tc-badge--cancelled { background: #f1f2f4; color: #55575c; }
      .tc-badge--disputed, .tc-badge--failed, .tc-badge--past_due { background: #fdeceb; color: #c0392b; }
      .tc-badge--paused, .tc-badge--trial, .tc-badge--unknown { background: #fdf3e3; color: #8a5a00; }
      .tc-empty, .tc-error, .tc-norecord { color: #55575c; padding: 4px 0; }
      .tc-error { color: #c0392b; }
      .tc-toggle { background: none; border: none; color: #1292ee; font-size: 12px; font-weight: 600; padding: 4px 0; cursor: pointer; }
      .tc-toggle:hover { text-decoration: underline; }
      .tc-btn-row { display: flex; gap: 8px; margin-top: 6px; }
      .tc-link-btn { display: inline-block; padding: 6px 12px; background: #314ddb; color: #fff !important; text-decoration: none; border-radius: 4px; font-size: 13px; font-weight: 600; }
      .tc-link-btn:hover { background: #253aad; }
      .tc-retry-btn { background: none; border: 1px solid #c0392b; color: #c0392b; font-size: 12px; font-weight: 600; padding: 4px 10px; border-radius: 4px; cursor: pointer; margin-left: 8px; }
      .tc-hidden { display: none; }
    </style>
  `;
}

function renderGroupHeader(groupId, title) {
  return `
    <button type="button" class="tc-group-header" onclick="
      var body = document.getElementById('${groupId}-body');
      var arrow = document.getElementById('${groupId}-arrow');
      var collapsed = body.className.indexOf('tc-hidden') !== -1;
      if (collapsed) { body.className = ''; arrow.textContent = '▾'; }
      else { body.className = 'tc-hidden'; arrow.textContent = '▸'; }
    ">
      <span class="tc-subheading">${escapeHtml(title)}</span>
      <span id="${groupId}-arrow" class="tc-group-arrow">▾</span>
    </button>
  `;
}

function renderGroup(groupId, title, items) {
  if (items.length === 0) {
    return `
      ${renderGroupHeader(groupId, title)}
      <div id="${groupId}-body">
        <div class="tc-empty">No ${escapeHtml(title.toLowerCase())} on file</div>
      </div>
    `;
  }

  const visible = items.slice(0, VISIBLE_COUNT);
  const rest = items.slice(VISIBLE_COUNT);

  const renderRow = (t) => `
    <div class="tc-row">
      <div class="tc-row-main">
        <span class="tc-row-product">${escapeHtml(t.product)}</span>
        <span class="tc-row-date">${formatDate(t.date)}</span>
      </div>
      <div class="tc-row-side">
        <span class="tc-row-amount">${formatAmount(t.amount, t.currency)}</span>
        ${statusBadge(t.status)}
      </div>
    </div>
  `;

  const visibleRows = visible.map(renderRow).join('');
  const restRows = rest.map(renderRow).join('');

  const toggle =
    rest.length > 0
      ? `
    <div id="${groupId}-rest" class="tc-hidden">${restRows}</div>
    <button type="button" class="tc-toggle" onclick="
      var rest = document.getElementById('${groupId}-rest');
      var btn = this;
      var showing = rest.className.indexOf('tc-hidden') === -1;
      if (showing) { rest.className = 'tc-hidden'; btn.textContent = 'Show more (${rest.length})'; }
      else { rest.className = ''; btn.textContent = 'Show less'; }
    ">Show more (${rest.length})</button>
  `
      : '';

  return `
    ${renderGroupHeader(groupId, title)}
    <div id="${groupId}-body">
      <div>${visibleRows}</div>
      ${toggle}
    </div>
  `;
}

function renderProfileLink(customerId, email) {
  // Confirmed live: ThriveCart's order view URL is
  // https://thrivecart.com/{accountSlug}/#/orders/view/{base64(email)}/live/overview
  // -- there's no customer ID (ThriveCart's API doesn't return one), the ID
  // segment is just the customer's email, base64-encoded then URL-escaped.
  const accountSlug = process.env.THRIVECART_ACCOUNT_SLUG || 'thatmusicteacher';
  const emailBase64 = email ? Buffer.from(email).toString('base64') : '';
  const template =
    process.env.THRIVECART_CUSTOMER_URL_TEMPLATE ||
    'https://thrivecart.com/{accountSlug}/#/orders/view/{emailBase64}/live/overview';
  const href = template
    .replace('{accountSlug}', encodeURIComponent(accountSlug))
    .replace('{emailBase64}', encodeURIComponent(emailBase64))
    .replace('{customerId}', encodeURIComponent(customerId ?? ''))
    .replace('{email}', encodeURIComponent(email ?? ''));
  return `<a class="tc-link-btn" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">Transactions</a>`;
}

function renderLearnLink() {
  // Confirmed live: ThriveCart Learn has no safe read-only "find student by
  // email" API (its only student-related endpoint, "Create new student," is
  // a write/enrollment action -- confirmed against ThriveCart's own official
  // API reference, which lists no read/search endpoint for students at all).
  //
  // A pre-filled ?search={email} link was tried, but ThriveCart's Learn
  // search is a client-side hash router that applied the filter
  // inconsistently -- worked once, then failed on identical URLs via both
  // link-click and manual reload, with no reliable fix available from our
  // side. Links to the plain student search screen instead; the agent
  // enters the email themselves.
  const accountSlug = process.env.THRIVECART_ACCOUNT_SLUG || 'thatmusicteacher';
  const template = process.env.THRIVECART_LEARN_URL_TEMPLATE || 'https://thrivecart.com/{accountSlug}/#/learn/students';
  const href = template.replace('{accountSlug}', encodeURIComponent(accountSlug));
  return `<a class="tc-link-btn" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">Learn</a>`;
}

function wrap(bodyHtml) {
  // No redundant "Transactions" heading -- HelpScout already labels this
  // section with the app's own name in the sidebar.
  return `<div class="tc-sidebar">${baseStyles()}${bodyHtml}</div>`;
}

function renderLoading() {
  return wrap('<div class="tc-empty">Loading transactions…</div>');
}

function renderNoRecord() {
  return wrap('<div class="tc-norecord">No ThriveCart record found</div>');
}

function renderError(retryToken, message = 'ThriveCart lookup failed') {
  const retryAttr = retryToken ? ` data-retry-token="${escapeHtml(retryToken)}"` : '';
  return wrap(`
    <div class="tc-error">
      ${escapeHtml(message)}
      <button type="button" class="tc-retry-btn" onclick="window.__tcRetry && window.__tcRetry(this)"${retryAttr}>Retry</button>
    </div>
    <script>
      window.__tcRetry = function (btn) {
        var token = btn.getAttribute('data-retry-token');
        var container = btn.closest('.tc-sidebar');
        if (!token || !container) return;
        btn.disabled = true;
        btn.textContent = 'Retrying…';
        fetch('/api/retry?token=' + encodeURIComponent(token))
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (data && data.html) {
              container.outerHTML = data.html;
            } else {
              btn.disabled = false;
              btn.textContent = 'Retry';
            }
          })
          .catch(function () {
            btn.disabled = false;
            btn.textContent = 'Retry';
          });
      };
    </script>
  `);
}

function renderLifetimeValue(lifetimeValue) {
  if (!lifetimeValue || lifetimeValue.length === 0) return '';
  const parts = lifetimeValue.map((lv) => formatAmount(lv.amount, lv.currency)).join(' / ');
  return `
    <div class="tc-ltv">
      <span class="tc-ltv-label">Lifetime Value</span>
      <span class="tc-ltv-amount">${escapeHtml(parts)}</span>
    </div>
  `;
}

function renderTransactions({ customerId, purchases, subscriptions, lifetimeValue, email }) {
  const body = `
    ${renderLifetimeValue(lifetimeValue)}
    ${renderGroup('tc-purchases', 'Individual Purchases', purchases)}
    ${renderGroup('tc-subscriptions', 'Subscriptions', subscriptions)}
    <div class="tc-btn-row">
      ${renderProfileLink(customerId, email)}
      ${renderLearnLink()}
    </div>
  `;
  return wrap(body);
}

module.exports = {
  renderLoading,
  renderNoRecord,
  renderError,
  renderTransactions,
};
