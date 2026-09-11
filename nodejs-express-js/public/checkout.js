// Hosted Fields payment page: create the card fields, tokenize, pay, follow the order.

var CONFIG = window.CONFIG;
/* The seam, resolved once from CSS ----------------------------------------
   The field iframes cannot read public/styles.css, and the allowlist has no
   selectors, no media queries and no url(). So the inside has to be told
   everything. Rather than keeping a second hand-written copy of the values —
   which drifts the first time someone edits one side — we read the same
   custom properties the container uses, and pass those.

   One consequence worth knowing: this must run after styles.css is applied,
   and again after any theme change (see applyTheme below).                */

var SEAM_VARS = {
  font:      '--pay-font',
  size:      '--pay-field-text',
  weight:    '--pay-field-weight',
  tracking:  '--pay-field-tracking',
  height:    '--pay-field-h',
  padX:      '--pay-field-pad-x',
  ink:       '--pay-ink',
  muted:     '--pay-muted',
  fieldBg:   '--pay-field-bg',
  accent:    '--pay-accent'
};

var SEAM_FALLBACK = {
  font:     '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  size:     '16px',
  weight:   '500',
  tracking: '0.01em',
  height:   '52px',
  padX:     '14px',
  ink:      '#0a0b0c',
  muted:    '#69747a',
  fieldBg:  '#ffffff',
  accent:   '#348bff'
};

function cssVar(name, fallback) {
  var raw = window.getComputedStyle(document.documentElement).getPropertyValue(name);
  if (!raw) { return fallback; }
  raw = raw.replace(/^\s+/, '').replace(/\s+$/, '');
  return raw === '' ? fallback : raw;
}

function seam() {
  var out = {};
  for (var key in SEAM_VARS) {
    if (Object.prototype.hasOwnProperty.call(SEAM_VARS, key)) {
      out[key] = cssVar(SEAM_VARS[key], SEAM_FALLBACK[key]);
    }
  }
  return out;
}

/* fieldStyle() — the bag handed to HostedFields.init({ style: ... }).

   Only these properties survive the allowlist; anything else is dropped with
   a console warning. No pseudo-elements, no selectors, no media queries, no
   url(). Note there is nothing here that positions or decorates: the border,
   radius, background edge, focus ring and error ring are all drawn on the
   container by styles.css, so the two surfaces never fight over the same
   pixel.

   - lineHeight equal to the container height is what centres the value
     vertically; the iframe has no flexbox to help.
   - fontVariantNumeric: 'tabular-nums' keeps the digits from shifting sideways
     as the payer types. Do not remove it.
   - backgroundColor has to match --pay-field-bg or the seam becomes visible
     as a rectangle inside the box, most obviously in dark mode.            */

function fieldStyle() {
  var s = seam();

  var base = {
    color: s.ink,
    backgroundColor: s.fieldBg,
    caretColor: s.accent,
    fontFamily: s.font,
    fontSize: s.size,
    fontWeight: s.weight,
    fontVariantNumeric: 'tabular-nums',
    letterSpacing: s.tracking,
    lineHeight: s.height,
    textAlign: 'left',
    padding: '0 ' + s.padX,
    border: '0',
    outline: 'none',
    transition: 'color 160ms cubic-bezier(0.4, 0, 0.2, 1)'
  };

  return {
    input: base,

    placeholder: {
      color: s.muted,
      fontWeight: s.weight,
      letterSpacing: s.tracking
    },

    /* The visible focus treatment is the ring on the container. Inside, focus
       only needs to keep the value legible and the caret branded — the SDK
       merges this over `input`. */
    focus: {
      color: s.ink,
      backgroundColor: s.fieldBg,
      caretColor: s.accent
    }
  };
}

var FIELD_STYLE = fieldStyle();


/* Theme --------------------------------------------------------------------
   CSS handles the container. The iframes get nothing from a media query or a
   class, so every theme change has to be pushed field by field.            */

var FIELD_IDS = ['cardNumber', 'expiryDate', 'cvv'];
var THEME_KEY = 'pay-theme';

function applyTheme(theme, sdk) {
  document.documentElement.setAttribute('data-theme', theme);
  try { window.localStorage.setItem(THEME_KEY, theme); } catch (e) {}

  var label = document.getElementById('themeToggle');
  if (label) {
    label.textContent = theme === 'dark' ? 'Light' : 'Dark';
    label.setAttribute('aria-label', theme === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme');
  }

  FIELD_STYLE = fieldStyle();
  if (sdk && sdk.setStyle) {
    for (var i = 0; i < FIELD_IDS.length; i++) {
      sdk.setStyle(FIELD_IDS[i], FIELD_STYLE);
    }
  }
}

function initTheme(sdk) {
  var stored = null;
  try { stored = window.localStorage.getItem(THEME_KEY); } catch (e) {}

  var media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  var theme = stored || (media && media.matches ? 'dark' : 'light');
  applyTheme(theme, sdk);

  var toggle = document.getElementById('themeToggle');
  if (toggle) {
    toggle.addEventListener('click', function () {
      var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      applyTheme(next, sdk);
    });
  }

  /* Follow the system while the payer has not chosen. */
  if (media && media.addEventListener && !stored) {
    media.addEventListener('change', function (event) {
      applyTheme(event.matches ? 'dark' : 'light', sdk);
    });
  }
}

/* Loading ------------------------------------------------------------------
   Call setFormLoading(false) from onReady. The class drives the skeleton bars
   and nothing else: no opacity, no transform, no overlay — all three are
   rejected on .hf-field.                                                    */

function setFormLoading(loading) {
  var form = document.getElementById('payForm');
  var pay = document.getElementById('pay');

  if (form) {
    if (loading) { form.className = 'pay-form pay-form--loading'; }
    else { form.className = 'pay-form'; }
  }
  if (pay) {
    pay.disabled = !!loading;
    pay.textContent = loading ? 'Preparing\u2026' : pay.getAttribute('data-label');
  }
}

/* Errors -------------------------------------------------------------------
   There is no per-field validity: the SDK sets .hf-field--error on all three
   at once, so the message has to say which value to look at. Two flavours —
   `retry` leaves the button live, `spent` does not, because the session is
   gone and only a reload can help.                                          */

var ERROR_COPY = {
  retry: 'Your card was declined by the issuing bank. Check the number, expiry and CVV, or try another card.',
  rejected: 'That card number was not accepted. Check the digits, then reload the page to start a new payment.',
  spent: 'This payment session has already been used. Reload the page to try again.',
  network: 'We could not reach the payment gateway. Check your connection and try again.'
};

/* Errors that burn the ephemeralTicket: the button cannot come back, because a
   retry would need a ticket this page no longer has. */
var TERMINAL_ERRORS = { rejected: 'Reload to try again', spent: 'Payment session closed' };

function showFormError(kind, message) {
  var box = document.getElementById('formError');
  var pay = document.getElementById('pay');
  var text = message || ERROR_COPY[kind] || ERROR_COPY.retry;

  if (box) {
    /* The glyph is markup, not a pseudo-element, so the error is never
       carried by colour alone; keep it and append the text after it. */
    var glyph = box.querySelector('svg');
    box.textContent = '';
    if (glyph) { box.appendChild(glyph); }
    var span = document.createElement('span');
    span.textContent = text;
    box.appendChild(span);
    box.setAttribute('role', 'alert');
  }

  for (var i = 0; i < FIELD_IDS.length; i++) {
    var el = document.getElementById(FIELD_IDS[i]);
    if (el && el.className.indexOf('hf-field--error') === -1) {
      el.className = el.className + ' hf-field--error';
    }
  }

  if (pay) {
    var terminal = TERMINAL_ERRORS[kind];
    pay.disabled = !!terminal;
    pay.textContent = terminal || pay.getAttribute('data-label');
  }
}

function clearFormError() {
  var box = document.getElementById('formError');
  if (box) {
    var glyph = box.querySelector('svg');
    box.textContent = '';
    if (glyph) { box.appendChild(glyph); }
    box.removeAttribute('role');
  }
  for (var i = 0; i < FIELD_IDS.length; i++) {
    var el = document.getElementById(FIELD_IDS[i]);
    if (el) { el.className = el.className.replace(/\s*hf-field--error/g, ''); }
  }
}

/* In flight ---------------------------------------------------------------- */

function setPayInFlight() {
  var pay = document.getElementById('pay');
  if (pay) {
    pay.disabled = true;
    pay.textContent = 'Processing\u2026';
  }
  clearFormError();
  if (window.showStatus) {
    window.showStatus({ status: 'processing' });
  }
}

/* Order summary ------------------------------------------------------------
   The amount the payer confirms must be the amount the server charges, so it
   comes from the config the page was rendered with, not from the markup.
   statusAmount() in status.js already formats it the way the panel will.   */

function setOrderSummary() {
  var money = statusAmount({ amount: CONFIG.amount, currency: CONFIG.currency });
  var amountEl = document.getElementById('orderAmount');
  var pay = document.getElementById('pay');

  if (amountEl) { amountEl.textContent = money; }
  if (pay) { pay.setAttribute('data-label', money ? 'Pay ' + money : 'Pay'); }
}

/* Our own fields -----------------------------------------------------------
   Same-origin inputs, so unlike the card boxes they get per-field validity
   and a message of their own.                                              */

// Latin only, and no digits. Neither is the platform's rule — its API validator accepts any
// character — but a name embossed on a card is Latin, some acquirers push the holder through an
// ASCII converter, and the gateway's own payment form rejects digits outright. Better to say so
// here than to have the card refused later.
var NAME_PATTERN = /^[A-Za-z][A-Za-z .'-]*$/;
var EMAIL_PATTERN = /^[^@\s]+@[^@\s.]+\.[^@\s]+$/;

// The Sale documentation gives first_name and last_name 50 characters each, and
// card_printed_name 128 of its own.
var NAME_MAX_LENGTH = 50;
var CARD_NAME_MAX_LENGTH = 128;

var CUSTOMER_FIELDS = [
  { id: 'firstName', hint: 'firstNameHint', empty: 'Enter the name on the card.', invalid: 'Up to 50 Latin letters, as printed on the card.', pattern: NAME_PATTERN, maxLength: NAME_MAX_LENGTH },
  { id: 'lastName', hint: 'lastNameHint', empty: 'Enter the surname on the card.', invalid: 'Up to 50 Latin letters, as printed on the card.', pattern: NAME_PATTERN, maxLength: NAME_MAX_LENGTH },
  { id: 'cardholderName', hint: 'cardholderNameHint', empty: 'Enter the name as printed on the card.', invalid: 'Latin letters only, as printed on the card.', pattern: NAME_PATTERN, maxLength: CARD_NAME_MAX_LENGTH },
  { id: 'email', hint: 'emailHint', empty: 'Enter an email we can send the receipt to.', invalid: 'This does not look like an email address.', pattern: EMAIL_PATTERN }
];

function setFieldHint(field, message) {
  var input = document.getElementById(field.id);
  var hint = document.getElementById(field.hint);

  if (input) {
    input.className = message ? 'pay-input pay-input--error' : 'pay-input';
    if (message) { input.setAttribute('aria-invalid', 'true'); }
    else { input.removeAttribute('aria-invalid'); }
  }
  if (hint) { hint.textContent = message || ''; }
}

function fieldValue(id) {
  var input = document.getElementById(id);
  return input ? input.value.replace(/^\s+/, '').replace(/\s+$/, '') : '';
}

/// The name for the card, suggested from the two fields above. The platform splits this string
/// back apart on the FIRST space, so the halves are joined by exactly one.
function cardPrintedName() {
  return (fieldValue('firstName') + ' ' + fieldValue('lastName')).replace(/\s+/g, ' ');
}

/// Until the payer touches the field themselves it follows the name and surname. After the
/// first edit it stops: the card may read something else entirely, and overwriting that would
/// undo their correction on the next keystroke upstairs.
var cardholderTouched = false;

/// Cards emboss the holder in capitals, so the field shows capitals as they are typed rather
/// than quietly changing the value on submit. Assigning `value` would drop the caret to the end
/// mid-word, so it is put back — the length never changes, upper-casing is one-for-one here.
function upperCaseCardholderName(input) {
  var upper = input.value.toUpperCase();
  if (upper === input.value) { return; }

  var caret = input.selectionStart;
  input.value = upper;
  if (caret !== null && caret !== undefined) { input.setSelectionRange(caret, caret); }
}

function syncCardholderName() {
  var input = document.getElementById('cardholderName');
  if (input && !cardholderTouched) { input.value = cardPrintedName().toUpperCase(); }
}

function watchCardholderName() {
  var cardholder = document.getElementById('cardholderName');
  if (cardholder) {
    cardholder.addEventListener('input', function () {
      cardholderTouched = true;
      upperCaseCardholderName(cardholder);
    });
    // Autofill does not always announce itself with an input event
    cardholder.addEventListener('change', function () { upperCaseCardholderName(cardholder); });
  }
  var sources = ['firstName', 'lastName'];
  for (var i = 0; i < sources.length; i++) {
    var input = document.getElementById(sources[i]);
    if (input) { input.addEventListener('input', syncCardholderName); }
  }
}

function customerDetails() {
  var out = { valid: true };

  for (var i = 0; i < CUSTOMER_FIELDS.length; i++) {
    var field = CUSTOMER_FIELDS[i];
    var value = fieldValue(field.id);

    // Caught here rather than after tokenization: a Sale the gateway refuses has already spent
    // the ephemeralTicket, and the payer would have to start over for a typo in their own name.
    var problem = '';
    if (value === '') {
      problem = field.empty;
    } else if ((field.maxLength && value.length > field.maxLength) || !field.pattern.test(value)) {
      problem = field.invalid;
    }

    setFieldHint(field, problem);
    if (problem) { out.valid = false; }
    out[field.id] = value;
  }

  // What the payer sees in the field is what the gateway gets, edited or not.
  out.cardPrintedName = out.cardholderName;
  return out;
}

setOrderSummary();
watchCardholderName();

// The SDK must be loaded from the gateway host with a classic script tag.
var script = document.createElement('script');
script.src = CONFIG.sdkUrl;
script.async = true;
script.onerror = function () { showFormError('network', 'Failed to load the Hosted Fields SDK.'); };
document.head.appendChild(script);

// Step 2. The ids of the containers double as the keys of the fields map.
window.onHostedFieldsReady = function (HostedFields) {
  var sdk = HostedFields.init({
    endpointId: CONFIG.endpointId,
    fields: {
      cardNumber: { type: 'pan', placeholder: '1234 1234 1234 1234', style: FIELD_STYLE },
      expiryDate: { type: 'exp', style: FIELD_STYLE },
      cvv: { type: 'cvv', style: FIELD_STYLE }
    },
    onReady: function () { setFormLoading(false); },
    onToken: sendTokenToServer,
    onError: showError
  });

  // Pushes the field styles too, so the iframes follow the theme
  initTheme(sdk);

  document.getElementById('payForm').addEventListener('submit', function (event) {
    event.preventDefault();
    if (!customerDetails().valid) { return; }
    setPayInFlight(); // one tokenization per ephemeralTicket
    sdk.tokenize(CONFIG.ephemeralTicket);
  });
};

// Step 3. Only the token reaches our server, never the card data.
function sendTokenToServer(hostedFieldsToken) {
  console.log('[HostedFields] token received');

  fetch(CONFIG.basePath + '/pay', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      hostedFieldsToken: hostedFieldsToken,
      browser: browserInfo(),
      customer: customerDetails()
    })
  })
    .then(function (response) { return response.json(); })
    .then(function (sale) {
      if (!sale['paynet-order-id']) {
        showFormError('retry', sale['error-message'] || sale.error);
        hideStatusPanel();
        return;
      }
      pollStatus({
        basePath: CONFIG.basePath,
        orderId: sale['paynet-order-id'],
        clientOrderId: sale.clientOrderId
      });
    })
    .catch(function (error) {
      showFormError('network', error.message);
      hideStatusPanel();
    });
}

// 3DS 2.0 browser data required by the Sale call
function browserInfo() {
  return {
    customer_browser_info: 'true',
    customer_browser_javascript_enabled: 'true',
    customer_browser_java_enabled: String(typeof navigator.javaEnabled === 'function' && navigator.javaEnabled()),
    customer_browser_accept_language: navigator.language,
    customer_browser_color_depth: String(screen.colorDepth),
    customer_browser_screen_width: String(screen.width),
    customer_browser_screen_height: String(screen.height),
    customer_browser_time_zone: String(new Date().getTimezoneOffset())
  };
}

// setPayInFlight() opens the panel on submit, before the token exists. If
// tokenizing or the sale then fails, the panel must not keep saying we are
// waiting on the bank.
function hideStatusPanel() {
  var panel = document.getElementById('orderStatus');
  if (panel) { panel.hidden = true; }
}

// message and tip are for the log, payerMessage is the only part safe to show to the payer
function showError(error) {
  console.error('[HostedFields] ' + error.code + ': ' + error.message, error.tip, error.field);

  // The whole 4xxx class spends the ephemeralTicket, so any retry needs a new
  // one. 4004 is the everyday case — a mistyped card — and saying "this session
  // has already been used" for a wrong digit only confuses the payer.
  var spentTicket = error.code >= 4000 && error.code < 5000;
  var kind = error.code === 4004 ? 'rejected' : (spentTicket ? 'spent' : 'retry');
  showFormError(kind, spentTicket ? null : error.payerMessage);
  hideStatusPanel();
}
