<?php

declare(strict_types=1);

// Settings, all of them environment variables. See .env.example.
//
// PHP has no startup to fail at: every request is a fresh script, so the five required values are
// checked here, on first use, instead of once at boot the way the Go and Express examples do. The
// same property is what lets `php -l` and the unit tests run with no credentials at all.
//
// PORT and LISTEN_ADDR are deliberately absent: PHP does not own the socket. `php -S` takes
// host:port on the command line and PHP-FPM gets it from nginx, so an app setting for either
// would be a variable this code reads and nothing obeys.

/**
 * Reads a KEY=value file, the way `node --env-file` does. A missing file is not an error.
 *
 * Nothing here calls putenv(): the values are returned and consulted after the real environment,
 * which is what lets a harness drive the app without writing an .env and keeps a stale .env from
 * winning over what the process was started with.
 */
function env_file(string $path): array
{
    static $cache = [];
    if (array_key_exists($path, $cache)) {
        return $cache[$path];
    }

    $values = [];
    $lines = @file($path, FILE_IGNORE_NEW_LINES);
    if ($lines !== false) {
        foreach ($lines as $line) {
            $line = trim($line);
            if ($line === '' || str_starts_with($line, '#')) {
                continue;
            }
            // The first = separates, so a value may contain more of them
            $parts = explode('=', $line, 2);
            if (count($parts) < 2) {
                continue;
            }
            $values[trim($parts[0])] = trim(trim($parts[1]), "\"'");
        }
    }

    return $cache[$path] = $values;
}

/**
 * One setting. The real environment first — `php -S` and PHP-FPM fill in different places, hence
 * all three — then .env, then the fallback. An empty value counts as unset, so a copied
 * .env.example fails with a message rather than half working.
 */
function env(string $name, string $fallback = ''): string
{
    $candidates = [getenv($name), $_SERVER[$name] ?? null, $_ENV[$name] ?? null];
    $candidates[] = env_file(__DIR__ . '/.env')[$name] ?? null;

    foreach ($candidates as $value) {
        if (is_string($value) && $value !== '') {
            return $value;
        }
    }
    return $fallback;
}

/** All the settings, read and validated once per request. */
function settings(): array
{
    static $settings = null;
    if ($settings !== null) {
        return $settings;
    }

    $basePath = env('BASE_PATH', '/hosted-fields-examples-php');
    $values = [
        // URL prefix everything is mounted under
        'basePath' => $basePath,
        // Origin the payer's browser sees, no path
        'publicUrl' => env('PUBLIC_URL', 'http://localhost:3003'),
        // No default: the gateway host is per-installation, and a stale one baked in here would
        // silently point a real payment somewhere it does not belong. Required below.
        'apiUrl' => env('API_URL'),
        'sdkUrl' => env('SDK_URL'),
        'endpointId' => env('ENDPOINT_ID'),
        'merchantLogin' => env('MERCHANT_LOGIN'),
        // Shared secret the gateway signs its callbacks with. Not the RSA key.
        'merchantControl' => env('MERCHANT_CONTROL'),
        'orderAmount' => env('ORDER_AMOUNT', '1.00'),
        'orderCurrency' => env('ORDER_CURRENCY', 'USD'),
    ];

    foreach (
        [
            'API_URL' => $values['apiUrl'],
            'SDK_URL' => $values['sdkUrl'],
            'ENDPOINT_ID' => $values['endpointId'],
            'MERCHANT_LOGIN' => $values['merchantLogin'],
            'MERCHANT_CONTROL' => $values['merchantControl'],
        ] as $name => $value
    ) {
        if ($value === '') {
            throw new RuntimeException($name . ' is not set, see .env.example');
        }
    }

    // Origin of SDK_URL, scheme and host only: the Content-Security-Policy has to name the host
    // the SDK bundle and the card iframes come from, and nothing else.
    $values['sdkOrigin'] = sdk_origin($values['sdkUrl']);
    // Where the payer lands after a 3DS challenge. The gateway POSTs there, so it is
    // /result/callback and not the /result page the callback redirects to — and it is built from
    // PUBLIC_URL, because behind a proxy the listen address is not what the browser sees.
    $values['redirectUrl'] = $values['publicUrl'] . $basePath . '/result/callback';
    // The key is a multi-line PEM, which neither systemd's EnvironmentFile nor most secret stores
    // handle well, so a path is the deployment-friendly form and the inline value the local one.
    // Read here and parsed in oauth.php, so a missing key fails the request and not the signature.
    $values['privateKeyPem'] = private_key_pem();

    return $settings = $values;
}

/** Scheme, host and port of a URL, or '' when it is not one. */
function sdk_origin(string $url): string
{
    $parts = parse_url($url);
    if (!is_array($parts) || ($parts['scheme'] ?? '') === '' || ($parts['host'] ?? '') === '') {
        return '';
    }
    $origin = $parts['scheme'] . '://' . $parts['host'];
    return isset($parts['port']) ? $origin . ':' . $parts['port'] : $origin;
}

/** The signing key, as text. A path is tried first and a path that cannot be read is fatal. */
function private_key_pem(): string
{
    $path = env('PRIVATE_KEY_PATH');
    if ($path !== '') {
        $pem = @file_get_contents($path);
        if ($pem === false) {
            throw new RuntimeException('the private key at ' . $path . ' could not be read');
        }
        return $pem;
    }
    $inline = env('PRIVATE_KEY');
    if ($inline !== '') {
        return $inline;
    }
    throw new RuntimeException('set PRIVATE_KEY_PATH or PRIVATE_KEY, see .env.example');
}
