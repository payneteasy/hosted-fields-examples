<?php

declare(strict_types=1);

// The three gateway calls the Hosted Fields flow needs.
// https://doc.payneteasy.com/integration/api_use_cases/hosted_fields.html

require_once __DIR__ . '/oauth.php';
require_once __DIR__ . '/settings.php';

/** Total time one call may take, body included. */
const GATEWAY_TIMEOUT = 30;

/**
 * Returns a single-use ticket the browser exchanges for a hosted fields token. It is valid for
 * 15 minutes and safe to put on the page.
 */
function get_ephemeral_ticket(): string
{
    $decoded = paynet_post_json('/api/v4/tokenize/create-ephemeral-ticket/');

    $ticket = $decoded['ephemeralTicket'] ?? null;
    if (!is_string($ticket) || trim($ticket) === '') {
        // A rejected request comes back as 4xx with a JSON body carrying the reason. Only that
        // one field is quoted: this reason travels on into config.js, where the browser can read
        // it, and the rest of the reply is the gateway's business and not the payer's.
        $message = $decoded['error-message'] ?? null;
        if (is_string($message) && $message !== '') {
            throw new RuntimeException('no ephemeralTicket: ' . $message);
        }
        throw new RuntimeException('no ephemeralTicket in the response');
    }

    return trim($ticket);
}

/**
 * Charges the card behind the hosted fields token. The token replaces credit_card_number,
 * expire_month, expire_year and cvv2 — sending those is an error.
 *
 * $payer holds the details our own inputs next to the card iframes collected, as
 * firstName / lastName / email / cardPrintedName.
 */
function create_sale(
    string $hostedFieldsToken,
    string $clientOrderId,
    string $ipAddress,
    array $browser,
    array $payer
): array {
    $settings = settings();

    $params = [
        'client_orderid' => $clientOrderId,
        'order_desc' => 'Hosted Fields example order',
        'amount' => $settings['orderAmount'],
        'currency' => $settings['orderCurrency'],
        'hosted_fields_token' => $hostedFieldsToken,
        // The hosted fields token does not carry the card holder, and with the token the platform
        // leaves it empty unless it is sent here — which some acquirers do not survive.
        'card_printed_name' => $payer['cardPrintedName'],
        'first_name' => $payer['firstName'],
        'last_name' => $payer['lastName'],
        'address1' => '100 Main st',
        'city' => 'Seattle',
        'zip_code' => '98102',
        'country' => 'US',
        'state' => 'WA',
        'phone' => '+12063582043',
        'email' => $payer['email'],
        'ipaddress' => $ipAddress,
        'redirect_url' => $settings['redirectUrl'],
    ];

    // 3DS 2.0 browser data, required by /api/v4/sale. It comes from the page, so a parameter the
    // server has already set is never taken from it: handle_pay() filters the body to the
    // documented keys and this loop refuses to overwrite, so neither guard is load-bearing on
    // its own.
    foreach ($browser as $key => $value) {
        if (!array_key_exists($key, $params)) {
            $params[$key] = $value;
        }
    }

    return paynet_post_json('/api/v4/sale/', $params);
}

/** Polled until the order reaches a final status. */
function get_status(string $orderId, string $clientOrderId): array
{
    return paynet_post_json('/api/v4/status/', [
        'login' => settings()['merchantLogin'],
        'client_orderid' => $clientOrderId,
        'orderid' => $orderId,
    ]);
}

/**
 * Sends a signed command and decodes the reply. A rejected request — a validation error or a
 * decline — comes back as 4xx with a JSON body, so the body is decoded whatever the status: it
 * carries the error-message for the page. Only a reply that is not JSON at all counts as a
 * failure of the call itself.
 */
function paynet_post_json(string $command, array $params = []): array
{
    [$body, $status] = paynet_post($command, $params);

    $decoded = json_decode($body, true);
    if (!is_array($decoded)) {
        // The body is not quoted: it reaches the page as {error}. The log line has the detail.
        throw new RuntimeException('gateway request failed with ' . $status);
    }

    return $decoded;
}

/** @return array{0: string, 1: int} the reply body and its status code */
function paynet_post(string $command, array $params): array
{
    $settings = settings();
    // The command carries both slashes, so the endpoint id joins it with nothing in between
    $endpoint = $settings['apiUrl'] . $command . $settings['endpointId'];

    ksort($params, SORT_STRING);

    $curl = curl_init();
    curl_setopt_array($curl, [
        CURLOPT_URL => $endpoint,
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => http_build_query($params, '', '&', PHP_QUERY_RFC1738),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => GATEWAY_TIMEOUT,
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/x-www-form-urlencoded',
            // Ask for JSON instead of the default x-www-form-urlencoded reply.
            // https://doc.payneteasy.com/integration/openapi.html
            'Accept: application/vnd.pay+json',
            'Authorization: ' . oauth_auth_header('POST', $endpoint, $params),
        ],
    ]);

    $body = curl_exec($curl);
    if (!is_string($body)) {
        throw new RuntimeException('the gateway could not be reached: ' . curl_error($curl));
    }
    $status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);

    error_log(sprintf('[paynet] POST %s -> %d%s', $endpoint, $status, log_reason($body)));

    return [$body, $status];
}

/**
 * What goes in the log beside the status code. Not the body: a status reply carries the card's
 * last four digits and the holder's name, and the ticket reply carries the ticket. The gateway
 * puts everything a log needs to be useful into these two fields anyway.
 */
function log_reason(string $body): string
{
    // JSON_BIGINT_AS_STRING for the reason Go's decoder is given UseNumber(): the gateway answers
    // paynet-order-id as a number in a sale reply and as a string everywhere else, and a long one
    // must keep its digits rather than print as 1.2345678901e+10.
    $decoded = json_decode($body, true, 512, JSON_BIGINT_AS_STRING);
    if (!is_array($decoded)) {
        return ' (reply is not JSON)';
    }

    $reason = '';
    $id = log_field($decoded, 'paynet-order-id');
    if ($id !== '') {
        $reason .= ' order ' . $id;
    }
    $message = log_field($decoded, 'error-message');
    if ($message !== '') {
        $reason .= ' ' . $message;
    }

    return $reason;
}

/** Renders one value of a decoded reply as a single line, whatever JSON type it arrived as. */
function log_field(array $decoded, string $name): string
{
    $value = $decoded[$name] ?? null;
    if ($value === null || is_array($value)) {
        return '';
    }
    if (is_bool($value)) {
        $value = $value ? 'true' : 'false';
    }

    return implode(' ', preg_split('/\s+/', (string) $value, -1, PREG_SPLIT_NO_EMPTY) ?: []);
}
