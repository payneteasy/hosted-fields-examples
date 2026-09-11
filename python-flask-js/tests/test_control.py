"""The 3DS return is only as good as this checksum: it is what separates a payer coming back from
the bank from somebody typing an order id into the address bar. The vectors below were computed
outside this code, so a change in how the string is assembled shows up here as a failure rather
than agreeing with itself. go-js/callback_test.go, nodejs-express-js/src/callback.test.js and
php-js/tests/control_test.php check the very same ones.
"""

import unittest

from tests.settings_stub import stub_settings

# Before importing the module under test: control.py reads MERCHANT_CONTROL from settings.py
stub_settings()

from control import SIGNED_CALLBACK_FIELDS, valid_callback  # noqa: E402

# sha1('approved' + '1234567' + 'hf-abc' + 'test-merchant-control')
CONTROL = "652ace404c4dfe8bba069ecee594ec23a89340e1"
CALLBACK = {
    "status": "approved",
    "orderid": "1234567",
    "merchant_order": "hf-abc",
    "control": CONTROL,
}


class TestValidCallback(unittest.TestCase):
    def test_accepts_what_the_gateway_signed(self):
        self.assertTrue(valid_callback(CALLBACK))

    def test_every_signed_field_is_part_of_the_checksum(self):
        for field in ("status", "orderid", "merchant_order"):
            with self.subTest(field=field):
                self.assertFalse(valid_callback({**CALLBACK, field: "edited"}))

    def test_rejects_a_wrong_control_of_the_right_length(self):
        wrong = CONTROL[:-1] + ("2" if CONTROL.endswith("1") else "1")
        self.assertEqual(len(wrong), len(CONTROL))
        self.assertFalse(valid_callback({**CALLBACK, "control": wrong}))

    def test_rejects_a_control_of_the_wrong_length_without_raising(self):
        # compare_digest is the reason this is a 403 and not a 500
        self.assertFalse(valid_callback({**CALLBACK, "control": "short"}))
        self.assertFalse(valid_callback({**CALLBACK, "control": CONTROL + "extra"}))

    def test_rejects_a_request_with_nothing_in_it(self):
        # sha1('' + '' + '' + 'test-merchant-control') — an empty callback still has a checksum,
        # and it is not the empty string, so a bare /result must not pass.
        self.assertFalse(valid_callback({}))
        self.assertTrue(valid_callback({"control": "1a66987ac24e927ff2979f83a41cb818936a9e62"}))

    def test_the_signed_fields_travel_in_the_order_the_page_wants(self):
        self.assertEqual(SIGNED_CALLBACK_FIELDS, ("status", "orderid", "merchant_order", "control"))
