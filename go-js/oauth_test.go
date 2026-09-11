package main

import (
	"net/url"
	"testing"
)

// The signature base string is where OAuth quietly breaks: every part has to be percent-encoded
// to RFC 3986, and url.QueryEscape is not. A wrong byte here is a 401 from the gateway with
// nothing in the log to say why, so these are the vectors that pin it down.

func TestEncodeIsRFC3986(t *testing.T) {
	cases := []struct{ in, want string }{
		// The five characters url.QueryEscape leaves alone and OAuth does not
		{"!'()*", "%21%27%28%29%2A"},
		// A space is %20, never +
		{"John Smith", "John%20Smith"},
		// + is a literal plus, and must not survive as one
		{"a+b", "a%2Bb"},
		// Unreserved characters are left exactly as they are
		{"abcXYZ019-._~", "abcXYZ019-._~"},
		// Non-ASCII is encoded per UTF-8 byte
		{"é", "%C3%A9"},
	}
	for _, c := range cases {
		if got := encode(c.in); got != c.want {
			t.Errorf("encode(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestNormalizeSortsByKey(t *testing.T) {
	params := url.Values{
		"oauth_consumer_key": {"merchant"},
		"amount":             {"1.00"},
		"client_orderid":     {"hf-1"},
	}
	want := "amount=1.00&client_orderid=hf-1&oauth_consumer_key=merchant"
	if got := normalize(params); got != want {
		t.Errorf("normalize() = %q, want %q", got, want)
	}
}

// The same vector as the Express example's oauth.test.js, so the two signatures cannot drift.
func TestBaseStringMatchesTheExpressExample(t *testing.T) {
	params := url.Values{
		"oauth_consumer_key": {"merchant"},
		"amount":             {"1.00"},
		"client_orderid":     {"hf-1"},
	}
	endpoint := "https://gateway.example/paynet/api/v4/sale/123"
	got := "POST&" + encode(endpoint) + "&" + encode(normalize(params))

	want := "POST&https%3A%2F%2Fgateway.example%2Fpaynet%2Fapi%2Fv4%2Fsale%2F123&" +
		"amount%3D1.00%26client_orderid%3Dhf-1%26oauth_consumer_key%3Dmerchant"
	if got != want {
		t.Errorf("base string = %q, want %q", got, want)
	}
}
