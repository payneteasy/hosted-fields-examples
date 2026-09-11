<?php

declare(strict_types=1);

// The 3DS return is only as good as this checksum: it is what separates a payer coming back from
// the bank from somebody typing an order id into the address bar. The vectors below were computed
// outside this code, so a change in how the string is assembled shows up here as a failure rather
// than agreeing with itself. go-js/callback_test.go and
// nodejs-express-js/src/callback.test.js check the very same ones.

require_once __DIR__ . '/../control.php';

// sha1('approved' . '1234567' . 'hf-abc' . 'test-merchant-control')
const CONTROL = '652ace404c4dfe8bba069ecee594ec23a89340e1';
const CALLBACK = [
    'status' => 'approved',
    'orderid' => '1234567',
    'merchant_order' => 'hf-abc',
    'control' => CONTROL,
];

test('a callback the gateway signed is accepted', function (): void {
    expect_true(valid_callback(CALLBACK), 'the signed callback');
});

test('every signed field is part of the checksum', function (): void {
    foreach (['status', 'orderid', 'merchant_order'] as $field) {
        expect_false(valid_callback([...CALLBACK, $field => 'edited']), $field . ' is not signed');
    }
});

test('a wrong control of the right length is rejected', function (): void {
    $wrong = substr(CONTROL, 0, -1) . (str_ends_with(CONTROL, '1') ? '2' : '1');
    expect_equals(strlen($wrong), strlen(CONTROL), 'the same length');
    expect_false(valid_callback([...CALLBACK, 'control' => $wrong]), 'a wrong checksum');
});

test('a control of the wrong length is rejected, not thrown on', function (): void {
    expect_false(valid_callback([...CALLBACK, 'control' => 'short']), 'too short');
    expect_false(valid_callback([...CALLBACK, 'control' => CONTROL . 'extra']), 'too long');
});

test('a request with nothing in it is rejected', function (): void {
    // sha1('' . '' . '' . 'test-merchant-control') — an empty callback still has a checksum, and
    // it is not the empty string, so a bare /result must not pass.
    expect_false(valid_callback([]), 'an empty callback');
    expect_true(
        valid_callback(['control' => '1a66987ac24e927ff2979f83a41cb818936a9e62']),
        'the checksum of an empty callback',
    );
});

test('the signed fields travel in the order the page wants them', function (): void {
    expect_equals(SIGNED_CALLBACK_FIELDS, ['status', 'orderid', 'merchant_order', 'control']);
});
