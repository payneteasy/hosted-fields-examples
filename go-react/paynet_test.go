package main

import (
	"strings"
	"testing"
)

// The gateway is not consistent about the JSON type of paynet-order-id — a sale reply answers
// with a number, other calls with a string — so the log line has to survive both. It used to
// decode into a typed struct, which reported a perfectly good sale reply as "reply is not JSON".
func TestLogReason(t *testing.T) {
	cases := []struct{ name, body, want string }{
		{
			"sale reply, order id as a number",
			`{"type":"async-form-response","paynet-order-id":12345,"merchant-order-id":"hf-abc"}`,
			" order 12345",
		},
		{
			"order id as a string",
			`{"paynet-order-id":"12345","merchant-order-id":"hf-abc"}`,
			" order 12345",
		},
		{
			"a long order id keeps its digits, rather than turning into 1.2345678901e+10",
			`{"paynet-order-id":12345678901}`,
			" order 12345678901",
		},
		{
			"a decline carries the reason as well",
			`{"paynet-order-id":12345,"error-message":"Declined by the issuer","error-code":3}`,
			" order 12345 Declined by the issuer",
		},
		{
			"a message spread over lines is flattened",
			`{"error-message":"Declined\n  by the issuer"}`,
			" Declined by the issuer",
		},
		{
			"nothing worth logging",
			`{"type":"async-form-response"}`,
			"",
		},
		{
			"a reply that really is not JSON says so",
			"type=async-form-response\npaynet-order-id=12345",
			" (reply is not JSON)",
		},
	}

	for _, c := range cases {
		if got := logReason([]byte(c.body)); got != c.want {
			t.Errorf("%s:\n got %q\nwant %q", c.name, got, c.want)
		}
	}
}

// The body itself must never reach the log: a status reply carries the card and the holder, and
// the ticket reply carries the ticket.
func TestLogReasonKeepsTheBodyOut(t *testing.T) {
	body := `{"paynet-order-id":12345,"card-printed-name":"JOHN SMITH","last-four-digits":"4448","ephemeralTicket":"secret-ticket"}`
	got := logReason([]byte(body))
	for _, secret := range []string{"JOHN SMITH", "4448", "secret-ticket"} {
		if strings.Contains(got, secret) {
			t.Errorf("logReason leaked %q in %q", secret, got)
		}
	}
}
