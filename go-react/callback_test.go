package main

import (
	"net/url"
	"testing"
)

// The 3DS return is only as good as this checksum: it is what separates a payer coming back from
// the bank from somebody typing an order id into the address bar. The vectors below were computed
// outside this code, and are the same ones the Express example uses, so neither can drift alone.

const testMerchantControl = "test-merchant-control"

// sha1("approved" + "1234567" + "hf-abc" + "test-merchant-control")
const testControl = "652ace404c4dfe8bba069ecee594ec23a89340e1"

func signedCallback() url.Values {
	return url.Values{
		"status":         {"approved"},
		"orderid":        {"1234567"},
		"merchant_order": {"hf-abc"},
		"control":        {testControl},
	}
}

func TestValidCallback(t *testing.T) {
	cfg.MerchantControl = testMerchantControl

	if !validCallback(signedCallback()) {
		t.Fatal("a callback the gateway signed was rejected")
	}

	// Every field the gateway signs has to be part of the checksum
	for _, field := range []string{"status", "orderid", "merchant_order"} {
		edited := signedCallback()
		edited.Set(field, "edited")
		if validCallback(edited) {
			t.Errorf("%s is not covered by the checksum", field)
		}
	}

	// A wrong control of the right length, which is what a guess looks like
	wrong := signedCallback()
	wrong.Set("control", testControl[:len(testControl)-1]+"0")
	if validCallback(wrong) {
		t.Error("a wrong control of the right length was accepted")
	}

	// A control of the wrong length must be rejected rather than panic
	for _, control := range []string{"", "short", testControl + "extra"} {
		odd := signedCallback()
		odd.Set("control", control)
		if validCallback(odd) {
			t.Errorf("control %q was accepted", control)
		}
	}
}

func TestEmptyCallbackStillHasAChecksum(t *testing.T) {
	cfg.MerchantControl = testMerchantControl

	// sha1("" + "" + "" + "test-merchant-control") — an empty callback is not the empty string,
	// so a bare /result must not pass on a missing control.
	if validCallback(url.Values{}) {
		t.Error("an empty callback with no control was accepted")
	}
	if !validCallback(url.Values{"control": {"1a66987ac24e927ff2979f83a41cb818936a9e62"}}) {
		t.Error("the checksum of an empty callback was rejected")
	}
}
