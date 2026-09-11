"""Routes and handlers. Everything is mounted under BASE_PATH, so several examples fit behind one
nginx.

The two pages are static files: the only thing this server generates is window.CONFIG, and it
hands that over as a script of its own. That is what lets views/ be identical whatever language
the example is written in.
"""

import json
import logging
import secrets
from urllib.parse import urlencode

from flask import Blueprint, Flask, jsonify, redirect, request, send_from_directory
from werkzeug.middleware.proxy_fix import ProxyFix

from control import SIGNED_CALLBACK_FIELDS, valid_callback
from paynet import create_sale, get_ephemeral_ticket, get_status
from settings import (
    BASE_PATH,
    ENDPOINT_ID,
    LISTEN_ADDR,
    ORDER_AMOUNT,
    ORDER_CURRENCY,
    PORT,
    PUBLIC_DIR,
    SDK_ORIGIN,
    SDK_URL,
    VIEWS_DIR,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
log = logging.getLogger(__name__)

# public/ is mounted on the prefix itself, so the pages can link their assets relatively:
# public/styles.css is served at {BASE_PATH}/styles.css. views/ sits outside it and is never
# reachable as a file — the two pages are read and sent by send_view() below. A rule with no
# arguments outranks one with a converter in Werkzeug, so /config.js still wins over the
# static <path:filename>.
app = Flask(__name__, static_folder=PUBLIC_DIR, static_url_path=BASE_PATH)
# The payer's address only arrives in X-Forwarded-For behind nginx, and the platform screens it
# for fraud. ProxyFix counts trusted proxies from the right, so with one nginx in front a caller
# cannot prepend an address of their own — the other examples take the leftmost entry and can be
# told what to believe. Either way this is only safe with a proxy in front, which is why the app
# listens on loopback by default.
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)

routes = Blueprint("hosted_fields", __name__, url_prefix=BASE_PATH)

# What a payment page ought to send. The policy is worth reading as part of the example: the card
# fields are iframes from the gateway, so the SDK host has to be named in frame-src as well as in
# script-src, and everything else is denied by default.
#
# No 'unsafe-inline' anywhere, which is why the result page's script lives in public/result.js
# rather than in the markup: nothing in views/ is templated, so there is nowhere to put a nonce.
CONTENT_SECURITY_POLICY = "; ".join(
    [
        "default-src 'none'",
        f"script-src 'self' {SDK_ORIGIN}",
        "style-src 'self'",
        # The three card inputs are cross-origin iframes served by the gateway
        f"frame-src {SDK_ORIGIN}",
        f"connect-src 'self' {SDK_ORIGIN}",
        "img-src 'self' data:",
        "base-uri 'none'",
        "form-action 'self'",
        "frame-ancestors 'none'",
    ]
)

# The 3DS 2.0 values the page is allowed to supply. Everything else the Sale needs — amount,
# currency, redirect_url, hosted_fields_token, client_orderid — belongs to the server, so the
# request body is filtered here rather than merged: a body naming "amount" would otherwise have
# chosen what the payer is charged.
BROWSER_FIELDS = (
    "customer_browser_info",
    "customer_browser_javascript_enabled",
    "customer_browser_java_enabled",
    "customer_browser_accept_language",
    "customer_browser_color_depth",
    "customer_browser_screen_width",
    "customer_browser_screen_height",
    "customer_browser_time_zone",
)


@routes.get("/")
def checkout():
    return send_view("checkout.html")


@routes.get("/config.js")
def config_js():
    """Step 1. A fresh single-use ticket for every page load, handed to the page as a script."""
    config = {
        "basePath": BASE_PATH,
        "sdkUrl": SDK_URL,
        "endpointId": ENDPOINT_ID,
        # The page shows what the server will actually charge
        "amount": ORDER_AMOUNT,
        "currency": ORDER_CURRENCY,
    }

    try:
        config["ephemeralTicket"] = get_ephemeral_ticket()
    except Exception as error:  # noqa: BLE001 - whatever went wrong, the page still has to load
        # This has to stay valid JavaScript whatever happened upstream, or the page cannot even
        # tell the payer that it did. checkout.js reads the absent ticket as terminal.
        log.error("[error] %s", error)
        config["error"] = str(error)

    return send_config_js(config)


@routes.get("/result-config.js")
def result_config_js():
    """The 3DS return page needs no ticket: there is no card on it to tokenize."""
    return send_config_js(
        {"basePath": BASE_PATH, "amount": ORDER_AMOUNT, "currency": ORDER_CURRENCY}
    )


@routes.post("/pay")
def pay():
    """Step 3. The browser has exchanged the card for a token; start the payment."""
    payment = request.get_json(silent=True)
    if not isinstance(payment, dict):
        return {"error": "malformed request body"}, 400

    token = payment.get("hostedFieldsToken")
    if not isinstance(token, str) or not token:
        return {"error": "hostedFieldsToken is required"}, 400

    browser = payment.get("browser")
    customer = payment.get("customer")

    try:
        client_order_id = new_client_order_id()
        sale = create_sale(
            token,
            client_order_id,
            client_ip(),
            pick_browser(browser if isinstance(browser, dict) else {}),
            payer_details(customer if isinstance(customer, dict) else {}),
        )
    except Exception as error:  # noqa: BLE001 - every gateway failure is one 502 to the page
        return fail(error)

    # clientOrderId last: it is the server's, and a gateway field of the same name must not win
    sale["clientOrderId"] = client_order_id
    return sale


@routes.get("/status")
def status():
    """Step 4. The page polls this until the order reaches a final status."""
    order_id = request.args.get("orderId", "")
    client_order_id = request.args.get("clientOrderId", "")
    if not order_id or not client_order_id:
        return {"error": "orderId and clientOrderId are required"}, 400

    try:
        reply = jsonify(get_status(order_id, client_order_id))
    except Exception as error:  # noqa: BLE001 - as above
        return fail(error)

    reply.headers["Cache-Control"] = "no-store"
    return reply


@routes.post("/result/callback")
def result_callback():
    """Step 5. Where the gateway returns the payer after a 3DS challenge, with a POST.

    It is not a page, because a page cannot be delivered by POST and still be reloadable: the
    signature is checked here and the payer is sent on to /result with the same signed parameters
    in the query. The browser carries them, but it cannot forge them — it does not know
    MERCHANT_CONTROL — and /result checks them again before it serves anything.
    """
    if not valid_callback(request.form):
        log.error("[error] callback signature mismatch for order %s", request.form.get("orderid", ""))
        return "invalid callback signature\n", 403, {"Content-Type": "text/plain; charset=utf-8"}

    # 303, so the browser follows with a GET whatever it arrived with
    return redirect(result_url(request.form), 303)


@routes.get("/result/callback")
def result_callback_get():
    """A GET here is nobody arriving from a payment; send them to the empty page."""
    return redirect(result_url({}), 303)


@routes.get("/result")
def result():
    """The 3DS return page.

    The callback carries the outcome too, but the documentation says not to treat it as the
    status — the page looks the order up over the API instead.
    """
    # The query is only there when the payer came through the callback. Rechecking it here is what
    # stops a hand-edited URL: without it the page would happily poll somebody else's order. No
    # query at all is fine — the page then says there is nothing to show.
    if request.args.get("orderid") and not valid_callback(request.args):
        log.error("[error] result signature mismatch for order %s", request.args.get("orderid"))
        return "invalid result signature\n", 403, {"Content-Type": "text/plain; charset=utf-8"}

    return send_view("result.html")


def send_view(name):
    """Both pages are served straight off disk, with nothing substituted into them."""
    reply = send_from_directory(VIEWS_DIR, name)
    reply.headers["Content-Security-Policy"] = CONTENT_SECURITY_POLICY
    reply.headers["X-Content-Type-Options"] = "nosniff"
    reply.headers["Referrer-Policy"] = "no-referrer"
    # The page carries the signed order parameters in its URL, and it is one payment's page.
    # send_from_directory has already set a Cache-Control of its own, so this replaces it.
    reply.headers["Cache-Control"] = "no-store"
    return reply


def send_config_js(config):
    """window.CONFIG as a script of its own: the only thing this server generates."""
    # Compact separators and no \\uXXXX escaping, because that is what JSON.stringify emits and
    # the examples are meant to hand the page the same bytes. The keys come out in insertion
    # order, as they do in the Express example; Go and PHP sort theirs.
    body = json.dumps(config, separators=(",", ":"), ensure_ascii=False)

    reply = app.response_class(f"window.CONFIG = {body};\n", mimetype="text/javascript")
    # The ticket inside is single-use, so this must never come from a cache
    reply.headers["Cache-Control"] = "no-store"
    return reply


def result_url(callback):
    """{BASE_PATH}/result with the four signed parameters, in the order the page wants them.

    Built from SIGNED_CALLBACK_FIELDS rather than from the form's own order, so every example
    sends the payer to the identical URL.
    """
    signed = urlencode(
        [(name, callback[name]) for name in SIGNED_CALLBACK_FIELDS if callback.get(name)]
    )
    return f"{BASE_PATH}/result" + (f"?{signed}" if signed else "")


def new_client_order_id():
    """The merchant's own identifier for the order.

    Random rather than sequential or clock-based: the page hands it back on every /status poll, so
    an id that can be guessed would make somebody else's order readable — and two payers in the
    same millisecond would have collided.
    """
    return f"hf-{secrets.token_hex(16)}"


def pick_browser(source):
    """Keeps the allowed fields and drops everything else.

    The last two come from the request headers, never from the body, so the caller cannot spoof
    them. Presence is the test, so a field the page sends empty is forwarded empty.
    """
    browser = {name: str(source[name]) for name in BROWSER_FIELDS if name in source}
    browser["customer_browser_accept_header"] = request.headers.get("Accept") or "*/*"
    browser["customer_browser_user_agent"] = request.headers.get("User-Agent") or ""
    return browser


def payer_details(customer):
    """The four payer details the Sale takes from our own inputs, as strings whatever arrived."""
    return {
        name: str(customer.get(name) or "")
        for name in ("firstName", "lastName", "email", "cardPrintedName")
    }


def client_ip():
    """The payer's address, which the platform uses for fraud screening.

    ProxyFix has already replaced REMOTE_ADDR with the entry X-Forwarded-For attributes to the
    client; the gateway wants a plain address, not an IPv6-mapped loopback.
    """
    address = request.remote_addr or ""
    if address == "::1":
        return "127.0.0.1"
    return address[7:] if address.startswith("::ffff:") else address


def fail(error):
    """Any gateway failure surfaces to the page as one 502 with a message."""
    log.error("[error] %s", error)
    return {"error": str(error)}, 502


app.register_blueprint(routes)


if __name__ == "__main__":
    # The development server. `debug` stays off and has to: the Werkzeug debugger is remote code
    # execution sitting behind a payment page, and the scripts it injects would breach the
    # Content-Security-Policy as well. Behind nginx this branch never runs — gunicorn imports
    # `app` from this module instead.
    log.info("Listening on http://%s:%d%s/", LISTEN_ADDR, PORT, BASE_PATH)
    app.run(host=LISTEN_ADDR, port=PORT)
