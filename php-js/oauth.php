<?php

declare(strict_types=1);

// OAuth 1.0a RSA-SHA256 request signing.
// https://doc.payneteasy.com/integration/general_api_usage/request_authentication_methods/oauth.html

require_once __DIR__ . '/settings.php';

/**
 * RFC 3986 percent encoding.
 *
 * rawurlencode() is already RFC 3986 and is the whole reason this is a one-line function worth
 * naming: urlencode() writes a space as + and would leave the signature wrong with nothing in
 * the gateway's answer to say why.
 */
function oauth_encode(string $value): string
{
    return rawurlencode($value);
}

/**
 * The signature base string: METHOD&url&sorted-parameters, each part percent-encoded. It carries
 * no secret, which is what makes it testable on its own — and it is where a signature usually
 * goes wrong, because every part has to be encoded to RFC 3986 rather than to the looser rules
 * the standard library applies.
 */
function oauth_base_string(string $method, string $url, array $params): string
{
    // SORT_STRING, not the default: PHP compares numeric-looking keys as numbers, and the
    // gateway sorts bytes.
    ksort($params, SORT_STRING);

    $pairs = [];
    foreach ($params as $key => $value) {
        $pairs[] = oauth_encode((string) $key) . '=' . oauth_encode((string) $value);
    }

    return strtoupper($method) . '&' . oauth_encode($url) . '&' . oauth_encode(implode('&', $pairs));
}

/**
 * Builds the Authorization header for a signed API call.
 * $bodyParams are the x-www-form-urlencoded parameters of the request, if any.
 */
function oauth_auth_header(string $method, string $url, array $bodyParams = []): string
{
    $oauth = [
        'oauth_consumer_key' => settings()['merchantLogin'],
        'oauth_nonce' => bin2hex(random_bytes(16)),
        'oauth_signature_method' => 'RSA-SHA256',
        'oauth_timestamp' => (string) time(),
        'oauth_version' => '1.0',
    ];

    // Body parameters first, so an oauth_* name can never be taken from the request
    $base = oauth_base_string($method, $url, array_merge($bodyParams, $oauth));

    $signature = '';
    if (!openssl_sign($base, $signature, oauth_private_key(), OPENSSL_ALGO_SHA256)) {
        throw new RuntimeException('the request could not be signed');
    }
    $oauth['oauth_signature'] = base64_encode($signature);

    // Header values are not encoded by the transport, so encode them here
    ksort($oauth, SORT_STRING);
    $pairs = [];
    foreach ($oauth as $key => $value) {
        $pairs[] = $key . '="' . oauth_encode($value) . '"';
    }

    return 'OAuth ' . implode(', ', $pairs);
}

/**
 * The parsed signing key. Accepts a PKCS#8 or PKCS#1 PEM, with real newlines or with escaped \n,
 * so the key can also live on a single line in an env variable.
 */
function oauth_private_key(): OpenSSLAsymmetricKey
{
    static $key = null;
    if ($key !== null) {
        return $key;
    }

    $parsed = openssl_pkey_get_private(str_replace('\n', "\n", settings()['privateKeyPem']));
    if ($parsed === false) {
        throw new RuntimeException('the private key is not a valid PEM block');
    }

    $details = openssl_pkey_get_details($parsed);
    if (!is_array($details) || $details['type'] !== OPENSSL_KEYTYPE_RSA) {
        throw new RuntimeException('the private key is not RSA, an RSA key is required');
    }

    return $key = $parsed;
}
