<?php

declare(strict_types=1);

// The signature base string is where OAuth quietly breaks: every part has to be percent-encoded
// to RFC 3986, and PHP's urlencode() is not. A wrong byte here is a 401 from the gateway with
// nothing in the log to say why, so these are the vectors that pin it down. They are the same
// ones go-js/oauth_test.go and nodejs-express-js/src/oauth.test.js use, so no example can drift
// away from the other two on its own.

require_once __DIR__ . '/../oauth.php';

test('oauth_encode is RFC 3986, not urlencode', function (): void {
    // The five characters encodeURIComponent leaves alone and OAuth does not
    expect_equals(oauth_encode("!'()*"), '%21%27%28%29%2A');
    // A space is %20, never +
    expect_equals(oauth_encode('John Smith'), 'John%20Smith');
    // + is a literal plus, and must not survive as one
    expect_equals(oauth_encode('a+b'), 'a%2Bb');
    // Unreserved characters are left exactly as they are
    expect_equals(oauth_encode('abcXYZ019-._~'), 'abcXYZ019-._~');
    // Non-ASCII is encoded per UTF-8 byte
    expect_equals(oauth_encode('é'), '%C3%A9');
});

test('oauth_base_string sorts the parameters and encodes each part once', function (): void {
    $base = oauth_base_string('post', 'https://gateway.example/paynet/api/v4/sale/123', [
        'oauth_consumer_key' => 'merchant',
        'amount' => '1.00',
        'client_orderid' => 'hf-1',
    ]);

    // METHOD is upper-cased, the URL is encoded whole, and the parameter list is encoded again
    expect_equals(
        $base,
        'POST&https%3A%2F%2Fgateway.example%2Fpaynet%2Fapi%2Fv4%2Fsale%2F123&'
            . 'amount%3D1.00%26client_orderid%3Dhf-1%26oauth_consumer_key%3Dmerchant',
    );
});

test('oauth_base_string orders by key, not by insertion', function (): void {
    $ordered = oauth_base_string('POST', 'https://gateway.example/x', ['a' => '1', 'b' => '2']);
    $shuffled = oauth_base_string('POST', 'https://gateway.example/x', ['b' => '2', 'a' => '1']);
    expect_equals($ordered, $shuffled);
});

test('oauth_base_string sorts keys as bytes, not as numbers', function (): void {
    // ksort's default would put '10' before '9', because PHP reads both as numbers. The gateway
    // sorts the parameter names as strings, and so does every other example.
    $base = oauth_base_string('POST', 'https://gateway.example/x', ['9' => 'nine', '10' => 'ten']);
    expect_equals($base, 'POST&https%3A%2F%2Fgateway.example%2Fx&10%3Dten%269%3Dnine');
});

test('an empty parameter still takes part in the signature', function (): void {
    // A Sale sends card_printed_name empty when the page has no holder name, and the gateway
    // signs what it receives — so the name has to be in the base string with nothing after the =.
    $base = oauth_base_string('POST', 'https://gateway.example/x', ['card_printed_name' => '']);
    expect_equals($base, 'POST&https%3A%2F%2Fgateway.example%2Fx&card_printed_name%3D');
});
