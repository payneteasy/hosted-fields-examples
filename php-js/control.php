<?php

declare(strict_types=1);

// The 3DS return callback: the checksum the gateway signs it with, and the fields that travel on.
// https://doc.payneteasy.com/integration/API_commands/merchant_callback_parameters.html
//
// This lives apart from index.php so it can be tested without starting a listener. Go keeps the
// same function in main.go, Express in src/callback.js and Next.js in src/shared/lib/callback.ts;
// all of them must agree.

require_once __DIR__ . '/settings.php';

/** The parameters the gateway signs its callback with, in the order the page wants them back. */
const SIGNED_CALLBACK_FIELDS = ['status', 'orderid', 'merchant_order', 'control'];

/**
 * Takes a form body or a query string: the same values travel on to /result, and are checked
 * again there with this very function.
 */
function valid_callback(array $source): bool
{
    $field = static fn(string $name): string => is_string($source[$name] ?? null) ? $source[$name] : '';

    $expected = sha1(
        $field('status') . $field('orderid') . $field('merchant_order') . settings()['merchantControl']
    );

    // hash_equals compares in constant time and answers false on a length mismatch instead of
    // throwing — and a wrong length is already a wrong checksum.
    return hash_equals($expected, $field('control'));
}
