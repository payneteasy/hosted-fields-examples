"""The 3DS return callback: the checksum the gateway signs it with, and the fields that travel on.

https://doc.payneteasy.com/integration/API_commands/merchant_callback_parameters.html

This lives apart from app.py so it can be tested without starting a listener. Go keeps the same
function in main.go, Express in src/callback.js, PHP in control.php and Next.js in
src/shared/lib/callback.ts; all of them must agree.
"""

import hashlib
import hmac

from settings import MERCHANT_CONTROL

# The parameters the gateway signs its callback with, in the order the page wants them back
SIGNED_CALLBACK_FIELDS = ("status", "orderid", "merchant_order", "control")


def valid_callback(source):
    """Takes a form body or a query string: the same values travel on to /result, and are checked
    again there with this very function.

    A Werkzeug MultiDict works as well as a plain dict, and .get() takes the first of a repeated
    name — so the value verified here is the value forwarded, which is what the second check on
    /result depends on.
    """

    def field(name):
        return str(source.get(name) or "")

    signed = field("status") + field("orderid") + field("merchant_order") + MERCHANT_CONTROL
    expected = hashlib.sha1(signed.encode("utf-8")).hexdigest()

    # compare_digest is constant time and returns False on a length mismatch instead of raising —
    # and a wrong length is already a wrong checksum.
    return hmac.compare_digest(expected, field("control"))
