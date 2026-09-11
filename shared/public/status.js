// Order status polling, shared by the payment page and the 3DS return page.
// SHARED FILE. The source of truth is shared/public/status.js; the copy in every app is
// written by scripts/sync-shared.sh. Edit it there, run the script, commit both.

var FINAL_STATUSES = ['approved', 'declined', 'error', 'filtered'];
var POLL_INTERVAL = 4000;
// Roughly three minutes. A payment that has not resolved by then is not going to resolve while
// the payer watches, and a page that polls a wedged server until the tab closes helps nobody.
var MAX_POLLS = 45;

// The order does not outlive the page: after the 3DS redirect the return page
// gets it from the server, which takes it from the signed callback.
function pollStatus(order) {
  var url = order.basePath + '/status?orderId=' + encodeURIComponent(order.orderId) +
    '&clientOrderId=' + encodeURIComponent(order.clientOrderId);

  order.attempts = (order.attempts || 0) + 1;

  fetch(url)
    .then(function (response) { return response.json(); })
    .then(function (status) {
      // A 502 from our own server parses as JSON too, and it carries no status — which reads as
      // 'processing' below. Without this the page would poll a broken server for as long as it
      // stayed open.
      if (!status.status) {
        showStatus({ status: 'error', 'error-message': status.error || 'The server did not return an order status.' });
        return;
      }

      showStatus(status);

      // 3DS: the gateway asks to send the payer to the issuer, once
      if (status['redirect-to'] && !order.redirected) {
        order.redirected = true;
        location.href = status['redirect-to'];
        return;
      }

      if (FINAL_STATUSES.indexOf(status.status) !== -1) return;

      if (order.attempts >= MAX_POLLS) {
        showStatus({ status: 'error', 'error-message': 'The bank did not answer in time. The payment may still complete — check your email or contact the merchant before paying again.' });
        return;
      }

      setTimeout(function () { pollStatus(order); }, POLL_INTERVAL);
    })
    .catch(function (error) { showStatus({ status: 'error', 'error-message': error.message }); });
}

/* ==========================================================================
   public/status.js — showStatus() only.

   Replaces the raw `key: value` dump in #orderStatus with a structured panel:
   verdict and amount first, then the handful of values a payer or a support
   agent would actually quote, then everything the gateway returned behind a
   disclosure. The polling logic above/below this function is untouched — it
   still calls showStatus(data) with the parsed gateway response.

   Plain ES5: var, function, no arrows, no template literals.
   ========================================================================== */

var STATUS_GLYPH = {
  check: '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M4.5 10.6l3.6 3.6L15.6 6.7" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  cross: '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M6 6l8 8M14 6l-8 8" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/></svg>',
  dots:  '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><circle cx="10" cy="10" r="7.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-dasharray="3.2 3.6" stroke-linecap="round"/></svg>'
};

/* One entry per final status the gateway can report, plus the in-flight case.
   `action` is the primary button; null means the panel ends with the details. */
var STATUS_COPY = {
  processing: {
    eyebrow: 'In progress',
    title: 'Contacting your bank',
    body: 'This can take up to a minute. Please do not close or reload this window.',
    glyph: 'dots',
    action: null
  },
  approved: {
    eyebrow: 'Payment complete',
    title: 'Approved',
    body: 'The merchant has been notified. A receipt is on its way to your email.',
    glyph: 'check',
    action: 'Back to the store'
  },
  declined: {
    eyebrow: 'Not completed',
    title: 'Declined',
    body: 'Your bank did not authorise this payment. Nothing has been charged. You can try again with another card.',
    glyph: 'cross',
    action: 'Try another card'
  },
  error: {
    eyebrow: 'Not completed',
    title: 'Something went wrong',
    body: 'The payment could not be finished and nothing has been charged. Reload the page to start a new payment.',
    glyph: 'cross',
    action: 'Reload the page'
  },
  filtered: {
    eyebrow: 'Filtered',
    title: 'Filtered',
    body: 'This payment was stopped by a security check and nothing has been charged. Contact the merchant if you believe this is a mistake.',
    glyph: 'dots',
    action: 'Contact the merchant'
  }
};

/* Which gateway fields get promoted into the readable list, in order.
   First key that is present wins; a row with no value is dropped.
   The gateway answers in kebab-case, so those spellings come first. */
var STATUS_ROWS = [
  { label: 'Amount',        format: 'amount' },
  { label: 'Card',          format: 'card' },
  { label: 'Cardholder',    keys: ['cardholder-name', 'cardholder_name'] },
  { label: 'Order',         keys: ['merchant-order-id', 'merchant_order_id', 'order_id'] },
  { label: 'Reference',     keys: ['paynet-order-id', 'paynet_order_id', 'processor-rrn', 'processor_rrn'] },
  { label: 'Approval code', keys: ['approval-code', 'approval_code'] },
  { label: 'Bank message',  keys: ['bank_message', 'error-message', 'error_message'] },
  { label: 'Filter',        keys: ['filter_message', 'fraud_message'] }
];

var CURRENCY_SIGN = { USD: '$', EUR: '\u20ac', GBP: '\u00a3', RUB: '\u20bd' };

function statusPick(data, keys) {
  if (!keys) { return ''; }
  for (var i = 0; i < keys.length; i++) {
    var v = data[keys[i]];
    if (v !== undefined && v !== null && String(v) !== '') { return String(v); }
  }
  return '';
}

/* Space-grouped thousands with the sign in front, per the brand's numbers
   convention: "$ 6 410 879.00". */
function statusAmount(data) {
  var raw = statusPick(data, ['amount', 'sum', 'total']);
  if (!raw) { return ''; }

  var parts = String(raw).replace(',', '.').split('.');
  var whole = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');
  var cents = parts.length > 1 ? '.' + parts[1] : '';
  var code = statusPick(data, ['currency', 'currency_code']).toUpperCase();
  var sign = CURRENCY_SIGN[code];

  if (sign) { return sign + '\u00a0' + whole + cents; }
  return whole + cents + (code ? '\u00a0' + code : '');
}

function statusCard(data) {
  var type = statusPick(data, ['card-type', 'card_type', 'card_brand', 'payment_method']);
  var last = statusPick(data, ['last-four-digits', 'last_four_digits', 'card_last4', 'last4']);
  if (!type && !last) { return ''; }
  if (!last) { return type; }
  return (type ? type + ' ' : '') + '\u2022\u2022\u2022\u2022\u00a0' + last;
}

function statusEl(tag, className, text) {
  var el = document.createElement(tag);
  if (className) { el.className = className; }
  if (text !== undefined && text !== null) { el.textContent = text; }
  return el;
}

function showStatus(data) {
  var panel = document.getElementById('orderStatus');
  if (!panel) { return; }

  data = data || {};
  var key = String(data.status || 'processing').toLowerCase();
  var copy = STATUS_COPY[key] || STATUS_COPY.error;
  var isFinal = key !== 'processing';

  panel.hidden = false;
  panel.className = 'status status--' + (isFinal ? key : 'processing');
  panel.setAttribute('aria-live', 'polite');
  panel.setAttribute('aria-busy', isFinal ? 'false' : 'true');
  panel.textContent = '';

  /* ---- verdict ---- */
  var head = statusEl('div', 'status__head');
  var badge = statusEl('span', 'status__badge');
  badge.innerHTML = STATUS_GLYPH[copy.glyph];
  var headText = statusEl('div');
  headText.appendChild(statusEl('div', 'status__eyebrow', copy.eyebrow));
  headText.appendChild(statusEl('h2', 'status__title', copy.title));
  head.appendChild(badge);
  head.appendChild(headText);
  panel.appendChild(head);

  panel.appendChild(statusEl('p', 'status__body', copy.body));

  /* ---- in flight: the three stages the polling code reports ---- */
  if (!isFinal) {
    var stages = [
      ['Card details tokenized', true],
      ['Payment sent to the gateway', true],
      ['Waiting for the bank', false]
    ];
    var list = statusEl('ol', 'status__steps');
    for (var s = 0; s < stages.length; s++) {
      var cls = 'status__step' + (stages[s][1] ? ' status__step--done' : '');
      list.appendChild(statusEl('li', cls, stages[s][0]));
    }
    panel.appendChild(list);
    return;
  }

  /* ---- promoted details ---- */
  var rows = statusEl('dl', 'status__rows');
  var shown = 0;
  for (var i = 0; i < STATUS_ROWS.length; i++) {
    var row = STATUS_ROWS[i];
    var value = '';
    if (row.format === 'amount') { value = statusAmount(data); }
    else if (row.format === 'card') { value = statusCard(data); }
    else { value = statusPick(data, row.keys); }
    if (!value) { continue; }
    rows.appendChild(statusEl('dt', null, row.label));
    rows.appendChild(statusEl('dd', null, value));
    shown++;
  }
  if (shown) { panel.appendChild(rows); }

  /* ---- everything else, one disclosure away ---- */
  var keys = [];
  for (var k in data) {
    if (Object.prototype.hasOwnProperty.call(data, k)) { keys.push(k); }
  }
  keys.sort();

  if (keys.length) {
    var details = statusEl('details', 'status__raw');
    details.appendChild(statusEl('summary', null, 'Show all ' + keys.length + ' gateway fields'));
    var grid = statusEl('dl', 'status__grid');
    for (var n = 0; n < keys.length; n++) {
      grid.appendChild(statusEl('dt', null, keys[n]));
      grid.appendChild(statusEl('dd', null, String(data[keys[n]])));
    }
    details.appendChild(grid);
    panel.appendChild(details);
  }

  /* ---- actions ---- */
  if (copy.action) {
    var actions = statusEl('div', 'status__actions');
    var primary = statusEl('button', 'btn-primary', copy.action);
    primary.type = 'button';
    // Everything lives under CONFIG.basePath: "/" would leave the app
    var home = (window.CONFIG && window.CONFIG.basePath ? window.CONFIG.basePath : '') + '/';
    if (key === 'error') {
      primary.onclick = function () { window.location.reload(); };
    } else {
      primary.onclick = function () { window.location.href = home; };
    }
    actions.appendChild(primary);

    var back = statusEl('a', 'btn-secondary', 'Back to the store');
    back.href = home;
    if (copy.action !== 'Back to the store') { actions.appendChild(back); }

    panel.appendChild(actions);
  }
}

window.showStatus = showStatus;
