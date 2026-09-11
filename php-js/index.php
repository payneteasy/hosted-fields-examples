<?php

declare(strict_types=1);

// Routes and handlers. Everything lives under BASE_PATH, so several examples fit behind one
// nginx.
//
// The two pages are static files: the only thing this server generates is window.CONFIG, and it
// hands that over as a script of its own. That is what lets views/ be identical whatever language
// the example is written in.
//
// Requests reach here two ways and both of them land on this one script: `php -S` through
// router.php, and nginx through PHP-FPM. Nothing is ever served off the filesystem by path —
// public/ goes out through an allowlist below — because the app root is also the `php -S`
// document root, and a path that reached the filesystem is how .env or this source would leak.

require_once __DIR__ . '/settings.php';
require_once __DIR__ . '/oauth.php';
require_once __DIR__ . '/control.php';
require_once __DIR__ . '/paynet.php';

/** Method and handler per route, relative to BASE_PATH. */
const ROUTES = [
    '/' => ['GET' => 'handle_checkout'],
    '/config.js' => ['GET' => 'handle_config_js'],
    '/result-config.js' => ['GET' => 'handle_result_config_js'],
    '/pay' => ['POST' => 'handle_pay'],
    '/status' => ['GET' => 'handle_status'],
    // The gateway returns the payer from a 3DS challenge with a POST, not a GET, so the callback
    // and the page it sends them to are separate routes.
    '/result/callback' => ['POST' => 'handle_result_callback', 'GET' => 'handle_result_callback'],
    '/result' => ['GET' => 'handle_result'],
];

/** The stylesheet and the client scripts, with the type each is served as. */
const STATIC_FILES = [
    'styles.css' => 'text/css; charset=utf-8',
    'status.js' => 'text/javascript; charset=utf-8',
    'checkout.js' => 'text/javascript; charset=utf-8',
    'result.js' => 'text/javascript; charset=utf-8',
];

function handle_request(string $method, string $uri): void
{
    $basePath = settings()['basePath'];
    $path = rawurldecode((string) parse_url($uri, PHP_URL_PATH));

    // The views link their assets relatively, so the payment page only works on the
    // trailing-slash form of the prefix. Send the bare prefix there, as Go's mux does.
    if ($path === $basePath) {
        send_redirect($basePath . '/', 307);
        return;
    }
    if (!str_starts_with($path, $basePath . '/')) {
        send_text(404, "404 page not found\n");
        return;
    }

    $route = substr($path, strlen($basePath));

    if (isset(ROUTES[$route])) {
        $handlers = ROUTES[$route];
        if (!isset($handlers[$method])) {
            header('Allow: ' . implode(', ', array_keys($handlers)));
            send_text(405, "Method Not Allowed\n");
            return;
        }
        $handlers[$method]();
        return;
    }

    $file = substr($route, 1);
    if ($method === 'GET' && isset(STATIC_FILES[$file])) {
        serve_static($file);
        return;
    }

    send_text(404, "404 page not found\n");
}

function handle_checkout(): void
{
    serve_view('checkout.html');
}

/** Step 1. A fresh single-use ticket for every page load, handed to the page as a script. */
function handle_config_js(): void
{
    $settings = settings();
    $config = [
        'basePath' => $settings['basePath'],
        'sdkUrl' => $settings['sdkUrl'],
        'endpointId' => $settings['endpointId'],
        // The page shows what the server will actually charge
        'amount' => $settings['orderAmount'],
        'currency' => $settings['orderCurrency'],
    ];

    try {
        $config['ephemeralTicket'] = get_ephemeral_ticket();
    } catch (Throwable $error) {
        // This has to stay valid JavaScript whatever happened upstream, or the page cannot even
        // tell the payer that it did. checkout.js reads the absent ticket as terminal.
        error_log('[error] ' . $error->getMessage());
        $config['error'] = $error->getMessage();
    }

    send_config_js($config);
}

/** The 3DS return page needs no ticket: there is no card on it to tokenize. */
function handle_result_config_js(): void
{
    $settings = settings();
    send_config_js([
        'basePath' => $settings['basePath'],
        'amount' => $settings['orderAmount'],
        'currency' => $settings['orderCurrency'],
    ]);
}

/** Step 3. The browser has exchanged the card for a token; start the payment. */
function handle_pay(): void
{
    $payment = json_decode(request_body(), true);
    if (!is_array($payment)) {
        send_json(400, ['error' => 'malformed request body']);
        return;
    }

    $token = $payment['hostedFieldsToken'] ?? null;
    if (!is_string($token) || $token === '') {
        send_json(400, ['error' => 'hostedFieldsToken is required']);
        return;
    }

    $browser = browser_params(is_array($payment['browser'] ?? null) ? $payment['browser'] : []);
    $payer = payer_details(is_array($payment['customer'] ?? null) ? $payment['customer'] : []);

    try {
        $clientOrderId = new_client_order_id();
        $sale = create_sale($token, $clientOrderId, client_ip(), $browser, $payer);
    } catch (Throwable $error) {
        fail($error);
        return;
    }

    $sale['clientOrderId'] = $clientOrderId;
    send_json(200, $sale);
}

/**
 * The merchant's own identifier for the order. It is random rather than sequential or clock-based:
 * the page hands it back on every /status poll, so an id that can be guessed would make somebody
 * else's order readable — and two payers in the same millisecond would have collided.
 */
function new_client_order_id(): string
{
    return 'hf-' . bin2hex(random_bytes(16));
}

/**
 * The 3DS 2.0 values the page is allowed to supply. Everything else the Sale needs — amount,
 * currency, redirect_url, hosted_fields_token, client_orderid — belongs to the server, so the
 * request body is filtered here rather than merged: a body naming "amount" would otherwise have
 * chosen what the payer is charged.
 */
const BROWSER_FIELDS = [
    'customer_browser_info',
    'customer_browser_javascript_enabled',
    'customer_browser_java_enabled',
    'customer_browser_accept_language',
    'customer_browser_color_depth',
    'customer_browser_screen_width',
    'customer_browser_screen_height',
    'customer_browser_time_zone',
];

/**
 * Keeps the allowed fields and drops everything else. The last two come from the request headers,
 * never from the body, so the caller cannot spoof them.
 *
 * Presence is the test, so a field the page sends empty is forwarded empty. Every value the page
 * sends is a string — the Go example decodes into a typed map and answers 400 to anything else —
 * and a value that is not one is dropped here rather than stringified into the Sale.
 */
function browser_params(array $source): array
{
    $browser = [];
    foreach (BROWSER_FIELDS as $name) {
        if (array_key_exists($name, $source) && is_string($source[$name])) {
            $browser[$name] = $source[$name];
        }
    }
    $browser['customer_browser_accept_header'] = request_header('Accept', '*/*');
    $browser['customer_browser_user_agent'] = request_header('User-Agent', '');

    return $browser;
}

/** The four payer details the Sale takes from our own inputs, as strings whatever arrived. */
function payer_details(array $customer): array
{
    $field = static fn(string $name): string => is_string($customer[$name] ?? null) ? $customer[$name] : '';

    return [
        'firstName' => $field('firstName'),
        'lastName' => $field('lastName'),
        'email' => $field('email'),
        'cardPrintedName' => $field('cardPrintedName'),
    ];
}

/** Step 4. The page polls this until the order reaches a final status. */
function handle_status(): void
{
    $query = query_params();
    $orderId = $query['orderId'] ?? '';
    $clientOrderId = $query['clientOrderId'] ?? '';
    if ($orderId === '' || $clientOrderId === '') {
        send_json(400, ['error' => 'orderId and clientOrderId are required']);
        return;
    }

    try {
        $status = get_status($orderId, $clientOrderId);
    } catch (Throwable $error) {
        fail($error);
        return;
    }

    header('Cache-Control: no-store');
    send_json(200, $status);
}

/**
 * Step 5. Where the gateway returns the payer after a 3DS challenge, with a POST. It is not a
 * page, because a page cannot be delivered by POST and still be reloadable: the signature is
 * checked here and the payer is sent on to /result with the same signed parameters in the query.
 * The browser carries them, but it cannot forge them — it does not know MERCHANT_CONTROL — and
 * /result checks them again before it serves anything.
 */
function handle_result_callback(): void
{
    // A GET here is nobody arriving from a payment; send them to the empty page.
    $posted = request_method() === 'POST';
    $form = $posted ? form_params(request_body()) : [];

    if ($posted && !valid_callback($form)) {
        error_log(sprintf('[error] callback signature mismatch for order "%s"', $form['orderid'] ?? ''));
        send_text(403, "invalid callback signature\n");
        return;
    }

    // Built by hand rather than with http_build_query, which sorts: every example puts these in
    // the same order, so the URL the payer ends up on is the same one everywhere.
    $signed = [];
    foreach (SIGNED_CALLBACK_FIELDS as $name) {
        $value = $form[$name] ?? '';
        if ($value !== '') {
            $signed[] = urlencode($name) . '=' . urlencode($value);
        }
    }

    $target = settings()['basePath'] . '/result';
    if ($signed !== []) {
        $target .= '?' . implode('&', $signed);
    }

    // 303, so the browser follows with a GET whatever it arrived with
    send_redirect($target, 303);
}

/**
 * The 3DS return page. The callback carries the outcome too, but the documentation says not to
 * treat it as the status — the page looks the order up over the API instead.
 */
function handle_result(): void
{
    // The query is only there when the payer came through the callback. Rechecking it here is
    // what stops a hand-edited URL: without it the page would happily poll somebody else's
    // order. No query at all is fine — the page then says there is nothing to show.
    $query = query_params();
    if (($query['orderid'] ?? '') !== '' && !valid_callback($query)) {
        error_log(sprintf('[error] result signature mismatch for order "%s"', $query['orderid']));
        send_text(403, "invalid result signature\n");
        return;
    }

    serve_view('result.html');
}

/** Both pages are served straight off disk, with nothing substituted into them. */
function serve_view(string $name): void
{
    $page = @file_get_contents(__DIR__ . '/views/' . $name);
    if ($page === false) {
        error_log('[error] views/' . $name . ' could not be read');
        send_text(500, "page not found\n");
        return;
    }

    security_headers();
    header('Content-Type: text/html; charset=utf-8');
    echo $page;
}

function serve_static(string $name): void
{
    $body = @file_get_contents(__DIR__ . '/public/' . $name);
    if ($body === false) {
        error_log('[error] public/' . $name . ' could not be read');
        send_text(404, "404 page not found\n");
        return;
    }

    header('Content-Type: ' . STATIC_FILES[$name]);
    header('X-Content-Type-Options: nosniff');
    echo $body;
}

/**
 * What a payment page ought to send. The policy is worth reading as part of the example: the card
 * fields are iframes from the gateway, so the SDK host has to be named in frame-src as well as in
 * script-src, and everything else is denied by default.
 *
 * No 'unsafe-inline' anywhere, which is why the result page's script lives in public/result.js
 * rather than in the markup: nothing in views/ is templated, so there is nowhere to put a nonce.
 */
function security_headers(): void
{
    $sdkOrigin = settings()['sdkOrigin'];
    $policy = [
        "default-src 'none'",
        "script-src 'self' " . $sdkOrigin,
        "style-src 'self'",
        // The three card inputs are cross-origin iframes served by the gateway
        'frame-src ' . $sdkOrigin,
        "connect-src 'self' " . $sdkOrigin,
        "img-src 'self' data:",
        "base-uri 'none'",
        "form-action 'self'",
        "frame-ancestors 'none'",
    ];

    header('Content-Security-Policy: ' . implode('; ', $policy));
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: no-referrer');
    // The page carries the signed order parameters in its URL, and it is one payment's page
    header('Cache-Control: no-store');
}

/** window.CONFIG as a script of its own: the only thing this server generates. */
function send_config_js(array $config): void
{
    // Sorted keys and < for the HTML-significant characters, so this is byte for byte the
    // script the other examples emit: Go's json.Marshal does both, and PHP has to be asked.
    ksort($config, SORT_STRING);
    $body = json_encode($config, JSON_HEX_TAG | JSON_HEX_AMP | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    if ($body === false) {
        error_log('[error] the page config could not be encoded');
        send_text(500, "could not build the page config\n");
        return;
    }

    header('Content-Type: text/javascript; charset=utf-8');
    // The ticket inside is single-use, so this must never come from a cache
    header('Cache-Control: no-store');
    echo 'window.CONFIG = ' . $body . ";\n";
}

function send_json(int $status, array $body): void
{
    ksort($body, SORT_STRING);
    $encoded = json_encode($body, JSON_HEX_TAG | JSON_HEX_AMP | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

    http_response_code($status);
    header('Content-Type: application/json');
    echo $encoded === false ? '{}' : $encoded, "\n";
}

function send_text(int $status, string $body): void
{
    http_response_code($status);
    header('Content-Type: text/plain; charset=utf-8');
    header('X-Content-Type-Options: nosniff');
    echo $body;
}

function send_redirect(string $target, int $status): void
{
    http_response_code($status);
    header('Location: ' . $target);
}

/** Any gateway failure surfaces to the page as one 502 with a message. */
function fail(Throwable $error): void
{
    error_log('[error] ' . $error->getMessage());
    send_json(502, ['error' => $error->getMessage()]);
}

/**
 * The payer's address, which the platform uses for fraud screening.
 *
 * Behind nginx it only arrives in X-Forwarded-For, so the proxy must set it — and the header is
 * taken on trust, which is one of the reasons the example expects to sit behind a proxy on
 * loopback. Exposed straight to the internet this would let any caller pick the address the
 * gateway screens.
 */
function client_ip(): string
{
    $address = is_string($_SERVER['REMOTE_ADDR'] ?? null) ? $_SERVER['REMOTE_ADDR'] : '';

    $forwarded = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? null;
    if (is_string($forwarded) && $forwarded !== '') {
        $address = trim(explode(',', $forwarded)[0]);
    }

    if ($address === '::1') {
        return '127.0.0.1';
    }
    return str_starts_with($address, '::ffff:') ? substr($address, 7) : $address;
}

function request_method(): string
{
    return is_string($_SERVER['REQUEST_METHOD'] ?? null) ? $_SERVER['REQUEST_METHOD'] : 'GET';
}

function request_header(string $name, string $fallback): string
{
    $value = $_SERVER['HTTP_' . strtoupper(str_replace('-', '_', $name))] ?? null;

    return is_string($value) && $value !== '' ? $value : $fallback;
}

function request_body(): string
{
    static $body = null;
    if ($body === null) {
        $body = (string) file_get_contents('php://input');
    }
    return $body;
}

function query_params(): array
{
    $uri = is_string($_SERVER['REQUEST_URI'] ?? null) ? $_SERVER['REQUEST_URI'] : '';

    return form_params((string) parse_url($uri, PHP_URL_QUERY));
}

/**
 * Parses an x-www-form-urlencoded body or query string.
 *
 * Not $_POST and not $_GET: PHP rewrites '.' and ' ' in a parameter name and keeps the last of a
 * repeated one, where Go and Node keep the first. The double signature check has to verify and
 * then forward the very same value, so the parser it reads is written out here.
 */
function form_params(string $encoded): array
{
    $params = [];
    foreach (explode('&', $encoded) as $pair) {
        if ($pair === '') {
            continue;
        }
        $parts = explode('=', $pair, 2);
        $name = urldecode($parts[0]);
        if (array_key_exists($name, $params)) {
            continue;
        }
        $params[$name] = urldecode($parts[1] ?? '');
    }

    return $params;
}

$method = request_method();
$uri = is_string($_SERVER['REQUEST_URI'] ?? null) ? $_SERVER['REQUEST_URI'] : '/';

try {
    if ($method === 'HEAD') {
        // A HEAD is a GET with the body dropped, and it has to answer with the headers the GET
        // would have sent — including a 403 on an edited /result. Go's mux matches HEAD on a GET
        // pattern for the same reason; PHP hands the body to the client unless it is discarded.
        ob_start();
        handle_request('GET', $uri);
        ob_end_clean();
    } else {
        handle_request($method, $uri);
    }
} catch (Throwable $error) {
    // A missing setting or an unreadable key is a misconfiguration, and PHP has no startup to
    // refuse it at the way the Go and Express examples do — so it surfaces here, once per
    // request, with the detail in the log and not on the page.
    error_log('[error] ' . $error->getMessage());
    if (!headers_sent()) {
        send_text(500, "the example is not configured, see .env.example\n");
    }
}
