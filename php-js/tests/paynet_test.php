<?php

declare(strict_types=1);

// The gateway is not consistent about the JSON type of paynet-order-id — a sale reply answers
// with a number, other calls with a string — so the log line has to survive both. The Go example
// used to decode into a typed struct, which reported a perfectly good sale reply as
// "reply is not JSON".

require_once __DIR__ . '/../paynet.php';

test('log_reason survives every type the gateway answers with', function (): void {
    $cases = [
        'sale reply, order id as a number' => [
            '{"type":"async-form-response","paynet-order-id":12345,"merchant-order-id":"hf-abc"}',
            ' order 12345',
        ],
        'order id as a string' => [
            '{"paynet-order-id":"12345","merchant-order-id":"hf-abc"}',
            ' order 12345',
        ],
        'a long order id keeps its digits, rather than turning into 1.2345678901e+10' => [
            '{"paynet-order-id":12345678901}',
            ' order 12345678901',
        ],
        'a decline carries the reason as well' => [
            '{"paynet-order-id":12345,"error-message":"Declined by the issuer","error-code":3}',
            ' order 12345 Declined by the issuer',
        ],
        'a message spread over lines is flattened' => [
            '{"error-message":"Declined\n  by the issuer"}',
            ' Declined by the issuer',
        ],
        'nothing worth logging' => [
            '{"type":"async-form-response"}',
            '',
        ],
        'a reply that really is not JSON says so' => [
            "type=async-form-response\npaynet-order-id=12345",
            ' (reply is not JSON)',
        ],
    ];

    foreach ($cases as $name => [$body, $want]) {
        expect_equals(log_reason($body), $want, $name);
    }
});

test('log_reason keeps the body out of the log', function (): void {
    // A status reply carries the card and the holder, and the ticket reply carries the ticket.
    $body = '{"paynet-order-id":12345,"card-printed-name":"JOHN SMITH","last-four-digits":"4448"'
        . ',"ephemeralTicket":"secret-ticket"}';
    $line = log_reason($body);

    foreach (['JOHN SMITH', '4448', 'secret-ticket'] as $secret) {
        expect_false(str_contains($line, $secret), 'log_reason leaked ' . $secret . ' in "' . $line . '"');
    }
});
