"""The three gateway calls the Hosted Fields flow needs.

https://doc.payneteasy.com/integration/api_use_cases/hosted_fields.html
"""

import json
import logging
import urllib.error
import urllib.request
from urllib.parse import urlencode

from oauth import build_auth_header
from settings import (
    API_URL,
    ENDPOINT_ID,
    MERCHANT_LOGIN,
    ORDER_AMOUNT,
    ORDER_CURRENCY,
    REDIRECT_URL,
)

log = logging.getLogger(__name__)

# The Go example's http.Client has the same 30 seconds, and Next passes the same AbortSignal:
# without one a wedged gateway holds the request, and the payer's page, indefinitely.
TIMEOUT = 30


def get_ephemeral_ticket():
    """Step 1. A single-use ticket the browser exchanges for a hosted fields token.

    Valid for 15 minutes and safe to put on the page.
    """
    reply = _post_json(f"{API_URL}/api/v4/tokenize/create-ephemeral-ticket/{ENDPOINT_ID}")

    ticket = str(reply.get("ephemeralTicket") or "").strip()
    if not ticket:
        # A rejected request comes back as 4xx with a JSON body carrying the reason. Only that one
        # field is quoted: this reason travels on into config.js, where the browser can read it,
        # and the rest of the reply is the gateway's business and not the payer's.
        raise RuntimeError(reply.get("error-message") or "no ephemeralTicket in the response")

    return ticket


def create_sale(hosted_fields_token, client_order_id, ip_address, browser, payer):
    """Step 3. Charges the card behind the hosted fields token.

    The token replaces credit_card_number, expire_month, expire_year and cvv2 — sending those is
    an error. `payer` holds what our own inputs next to the card iframes collected, as
    firstName / lastName / email / cardPrintedName.
    """
    # 3DS 2.0 browser data, required by /api/v4/sale. It comes from the page, so it goes first and
    # every server-owned field below overwrites it — app.py has already filtered it to the
    # documented keys, and this ordering is what keeps that a belt and not a single thread.
    params = dict(browser)
    params.update(
        {
            "client_orderid": client_order_id,
            "order_desc": "Hosted Fields example order",
            "amount": ORDER_AMOUNT,
            "currency": ORDER_CURRENCY,
            "hosted_fields_token": hosted_fields_token,
            # Composed by the page from first and last name: the hosted fields token does not
            # carry the holder, and with the token the platform leaves it empty unless it is sent
            # here — which some acquirers do not survive.
            "card_printed_name": payer["cardPrintedName"],
            "first_name": payer["firstName"],
            "last_name": payer["lastName"],
            "address1": "100 Main st",
            "city": "Seattle",
            "zip_code": "98102",
            "country": "US",
            "state": "WA",
            "phone": "+12063582043",
            "email": payer["email"],
            "ipaddress": ip_address,
            "redirect_url": REDIRECT_URL,
        }
    )

    return _post_json(f"{API_URL}/api/v4/sale/{ENDPOINT_ID}", params)


def get_status(order_id, client_order_id):
    """Step 4. Polled until the order reaches a final status."""
    return _post_json(
        f"{API_URL}/api/v4/status/{ENDPOINT_ID}",
        {"login": MERCHANT_LOGIN, "client_orderid": client_order_id, "orderid": order_id},
    )


def _post_json(url, params=None):
    """Sends a signed command and decodes the reply.

    A rejected request — a validation error or a decline — comes back as 4xx with a JSON body, so
    the body is decoded whatever the status: it carries the error-message for the page. Only a
    reply that is not a JSON object at all counts as a failure of the call itself.
    """
    text, status = _post(url, params)

    try:
        decoded = json.loads(text)
    except ValueError:
        decoded = None
    if not isinstance(decoded, dict):
        # The body is not quoted: it reaches the page as {error}. The log line has the detail.
        raise RuntimeError(f"gateway request failed with {status}")

    return decoded


def _post(url, params=None):
    """The transport. Always POST, always form-encoded, always signed."""
    request = urllib.request.Request(
        url,
        data=urlencode(params or {}).encode("utf-8"),
        method="POST",
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            # Ask for JSON instead of the default x-www-form-urlencoded reply, which arrives as
            # key=value pairs separated by newlines.
            # https://doc.payneteasy.com/integration/openapi.html
            "Accept": "application/vnd.pay+json",
            "Authorization": build_auth_header("POST", url, params or {}),
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as reply:
            text, status = reply.read().decode("utf-8", "replace"), reply.status
    except urllib.error.HTTPError as error:
        # urlopen raises on any 4xx, and a rejected request *is* a 4xx carrying the JSON body the
        # page needs. So the body is read off the exception and decoded like any other reply.
        # Letting this propagate instead would turn every decline into a 502.
        try:
            text, status = error.read().decode("utf-8", "replace"), error.code
        finally:
            error.close()

    log.info("[paynet] POST %s -> %d%s", url, status, log_reason(text))
    return text, status


def log_reason(text):
    """What goes in the log beside the status code.

    Not the body: a status reply carries the card's last four digits and the holder's name, and the
    ticket reply carries the ticket. The gateway puts everything a log needs to be useful into
    these two fields anyway.
    """
    try:
        decoded = json.loads(text)
    except ValueError:
        return " (reply is not JSON)"
    if not isinstance(decoded, dict):
        return " (reply is not JSON)"

    reason = ""
    order_id = _log_field(decoded, "paynet-order-id")
    if order_id:
        reason += f" order {order_id}"
    message = _log_field(decoded, "error-message")
    if message:
        reason += f" {message}"

    return reason


def _log_field(decoded, name):
    """Renders one value of a decoded reply as a single line, whatever JSON type it arrived as.

    The gateway answers paynet-order-id as a number in a sale reply and as a string everywhere
    else; json.loads keeps an integer exact, so a long one does not print as 1.2345678901e+10.
    """
    value = decoded.get(name)
    if value is None or isinstance(value, (dict, list)):
        return ""
    if isinstance(value, bool):
        value = "true" if value else "false"

    return " ".join(str(value).split())
