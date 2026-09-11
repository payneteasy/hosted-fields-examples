"""settings.py validates when it is imported, and every module under test reaches it through the
import graph. The tests do not sign anything and do not call the gateway, so the values only have
to be present — except MERCHANT_CONTROL, which the callback checksum is built from.

They go into os.environ, which settings.env() reads first, so a value already exported in the
shell wins. That is the same bargain nodejs-express-js/src/settings-stub.js makes.
"""

import os

MERCHANT_CONTROL = "test-merchant-control"

_STUB = {
    "API_URL": "https://gateway.example/paynet",
    "SDK_URL": "https://gateway.example/assets/hosted-fields.js",
    "ENDPOINT_ID": "1234567",
    "MERCHANT_LOGIN": "test-merchant",
    "MERCHANT_CONTROL": MERCHANT_CONTROL,
    "PRIVATE_KEY": "not a key: nothing here signs anything",
}


def stub_settings():
    for name, value in _STUB.items():
        os.environ.setdefault(name, value)
