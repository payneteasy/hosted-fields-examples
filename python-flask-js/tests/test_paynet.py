"""The gateway is not consistent about the JSON type of paynet-order-id — a sale reply answers with
a number, other calls with a string — so the log line has to survive both. The Go example used to
decode into a typed struct, which reported a perfectly good sale reply as "reply is not JSON".
"""

import unittest

from tests.settings_stub import stub_settings

# Before importing the module under test: paynet.py imports oauth.py, which imports settings.py
stub_settings()

from paynet import log_reason  # noqa: E402


class TestLogReason(unittest.TestCase):
    def test_survives_every_type_the_gateway_answers_with(self):
        cases = {
            "sale reply, order id as a number": (
                '{"type":"async-form-response","paynet-order-id":12345,"merchant-order-id":"hf-abc"}',
                " order 12345",
            ),
            "order id as a string": (
                '{"paynet-order-id":"12345","merchant-order-id":"hf-abc"}',
                " order 12345",
            ),
            "a long order id keeps its digits, rather than turning into 1.2345678901e+10": (
                '{"paynet-order-id":12345678901}',
                " order 12345678901",
            ),
            "a decline carries the reason as well": (
                '{"paynet-order-id":12345,"error-message":"Declined by the issuer","error-code":3}',
                " order 12345 Declined by the issuer",
            ),
            "a message spread over lines is flattened": (
                r'{"error-message":"Declined\n  by the issuer"}',
                " Declined by the issuer",
            ),
            "nothing worth logging": (
                '{"type":"async-form-response"}',
                "",
            ),
            "a reply that really is not JSON says so": (
                "type=async-form-response\npaynet-order-id=12345",
                " (reply is not JSON)",
            ),
        }

        for name, (body, want) in cases.items():
            with self.subTest(name):
                self.assertEqual(log_reason(body), want)

    def test_keeps_the_body_out_of_the_log(self):
        # A status reply carries the card and the holder, and the ticket reply carries the ticket.
        body = (
            '{"paynet-order-id":12345,"card-printed-name":"JOHN SMITH","last-four-digits":"4448"'
            ',"ephemeralTicket":"secret-ticket"}'
        )
        line = log_reason(body)

        for secret in ("JOHN SMITH", "4448", "secret-ticket"):
            with self.subTest(secret):
                self.assertNotIn(secret, line)
