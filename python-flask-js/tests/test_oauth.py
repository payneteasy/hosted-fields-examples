"""The signature base string is where OAuth quietly breaks: every part has to be percent-encoded
to RFC 3986, and the standard library's defaults are not. A wrong byte here is a 401 from the
gateway with nothing in the log to say why, so these are the vectors that pin it down.

They are the same ones go-js/oauth_test.go, nodejs-express-js/src/oauth.test.js and
php-js/tests/oauth_test.php use, so no example can drift away from the others on its own.
"""

import unittest

from tests.settings_stub import stub_settings

# Before importing the module under test: settings.py validates at import, and oauth.py reaches it
stub_settings()

from oauth import base_string, encode  # noqa: E402


class TestEncode(unittest.TestCase):
    def test_is_rfc_3986(self):
        # The five characters JavaScript's encodeURIComponent leaves alone and OAuth does not
        self.assertEqual(encode("!'()*"), "%21%27%28%29%2A")
        # A space is %20, never +
        self.assertEqual(encode("John Smith"), "John%20Smith")
        # + is a literal plus, and must not survive as one
        self.assertEqual(encode("a+b"), "a%2Bb")
        # Unreserved characters are left exactly as they are
        self.assertEqual(encode("abcXYZ019-._~"), "abcXYZ019-._~")
        # Non-ASCII is encoded per UTF-8 byte
        self.assertEqual(encode("é"), "%C3%A9")

    def test_escapes_the_slash(self):
        # quote()'s default safe='/' is the trap: a URL inside a parameter has to be encoded whole
        self.assertEqual(encode("https://gateway.example/x"), "https%3A%2F%2Fgateway.example%2Fx")


class TestBaseString(unittest.TestCase):
    def test_sorts_and_encodes_each_part_once(self):
        base = base_string(
            "post",
            "https://gateway.example/paynet/api/v4/sale/123",
            {"oauth_consumer_key": "merchant", "amount": "1.00", "client_orderid": "hf-1"},
        )

        # METHOD is upper-cased, the URL is encoded whole, and the parameter list is encoded again
        self.assertEqual(
            base,
            "POST&https%3A%2F%2Fgateway.example%2Fpaynet%2Fapi%2Fv4%2Fsale%2F123&"
            "amount%3D1.00%26client_orderid%3Dhf-1%26oauth_consumer_key%3Dmerchant",
        )

    def test_orders_by_key_not_by_insertion(self):
        ordered = base_string("POST", "https://gateway.example/x", {"a": "1", "b": "2"})
        shuffled = base_string("POST", "https://gateway.example/x", {"b": "2", "a": "1"})
        self.assertEqual(ordered, shuffled)

    def test_an_empty_parameter_still_takes_part(self):
        # A Sale sends card_printed_name empty when the page has no holder name, and the gateway
        # signs what it receives — so the name belongs in the base string with nothing after the =.
        base = base_string("POST", "https://gateway.example/x", {"card_printed_name": ""})
        self.assertEqual(base, "POST&https%3A%2F%2Fgateway.example%2Fx&card_printed_name%3D")
