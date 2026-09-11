// The 3DS return page, once the config and status.js are in.
// SHARED FILE. The source of truth is shared/public/result.js; the copy in every app is
// written by scripts/sync-shared.sh. Edit it there, run the script, commit both.
//
// This was an inline <script> in result.html until the pages started sending a Content-Security
// Policy. A nonce cannot go in the markup — nothing in views/ is templated, and that is what
// lets the same HTML serve from every example — so the script moved out here instead and the
// policy can name 'self' with no exception for inline code.

// No SDK on this page, so no sdk.setStyle() — but the payer's theme still has
// to survive the trip to the bank and back.
(function () {
  var stored = null;
  try { stored = window.localStorage.getItem('pay-theme'); } catch (e) {}
  var dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.setAttribute('data-theme', stored || (dark ? 'dark' : 'light'));
})();

// The amount the gateway was asked for
document.getElementById('orderAmount').textContent =
  statusAmount({ amount: CONFIG.amount, currency: CONFIG.currency });

// The payer comes back here after the 3DS challenge. The order is in the query the callback
// redirected to, alongside the `control` checksum the gateway signed it with — and the server
// rechecks that checksum on every request for this page, so an edited URL never gets served.
// Nothing is kept in sessionStorage and nothing is taken on the browser's word.
var params = new URLSearchParams(window.location.search);
var orderId = params.get('orderid') || '';
var clientOrderId = params.get('merchant_order') || '';

if (clientOrderId) {
  document.getElementById('orderRef').textContent = 'Order ' + clientOrderId;
}

if (orderId) {
  pollStatus({
    basePath: CONFIG.basePath,
    orderId: orderId,
    clientOrderId: clientOrderId,
    redirected: true // already back from the issuer, do not bounce there again
  });
} else {
  showStatus({ status: 'error', 'error-message': 'Nothing to show: open this page from a payment.' });
}
