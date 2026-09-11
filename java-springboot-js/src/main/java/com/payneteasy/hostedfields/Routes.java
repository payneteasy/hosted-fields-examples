package com.payneteasy.hostedfields;

import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.ObjectMapper;

/**
 * Every route of the example. They all live under BASE_PATH, which is the servlet context path, so
 * several examples fit behind one nginx.
 *
 * <p>The two pages are static files: the only thing this server generates is {@code window.CONFIG},
 * and it hands that over as a script of its own. That is what lets {@code views/} be identical
 * whatever language the example is written in.
 */
@RestController
final class Routes {

    private static final Logger LOG = LoggerFactory.getLogger(Routes.class);

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final SecureRandom RANDOM = new SecureRandom();

    /** The stylesheet and the client scripts, with the type each is served as. An allowlist, and
     *  the mapping below is the same list: it is what keeps views/, the sources and anything else
     *  that ever lands on the classpath unreachable. */
    private static final Map<String, String> ASSETS = Map.of(
            "styles.css", "text/css; charset=utf-8",
            "checkout.js", "text/javascript; charset=utf-8",
            "status.js", "text/javascript; charset=utf-8",
            "result.js", "text/javascript; charset=utf-8");

    /**
     * The 3DS 2.0 values the page is allowed to supply. Everything else the Sale needs — amount,
     * currency, redirect_url, hosted_fields_token, client_orderid — belongs to the server, so the
     * request body is filtered here rather than merged: a body naming "amount" would otherwise
     * have chosen what the payer is charged.
     */
    private static final List<String> BROWSER_FIELDS = List.of(
            "customer_browser_info",
            "customer_browser_javascript_enabled",
            "customer_browser_java_enabled",
            "customer_browser_accept_language",
            "customer_browser_color_depth",
            "customer_browser_screen_width",
            "customer_browser_screen_height",
            "customer_browser_time_zone");

    /** The parameters the gateway signs its callback with, in the order the page wants them back. */
    private static final List<String> SIGNED_CALLBACK_FIELDS =
            List.of("status", "orderid", "merchant_order", "control");

    /** Precompiled, and split with a negative limit below: the plain String.split drops trailing
     *  empty fields, which is one of the surprising corners Error Prone refuses to let pass. */
    private static final Pattern PAIRS = Pattern.compile("&");

    private final Settings settings;
    private final Paynet paynet;

    Routes(Settings settings) {
        this.settings = settings;
        this.paynet = new Paynet(settings);
    }

    @GetMapping("/")
    ResponseEntity<byte[]> checkout() {
        return view("checkout.html");
    }

    /** Step 1. A fresh single-use ticket for every page load, handed to the page as a script. */
    @GetMapping("/config.js")
    ResponseEntity<byte[]> configJs() {
        Map<String, String> config = new LinkedHashMap<>();
        config.put("basePath", settings.basePath());
        config.put("sdkUrl", settings.sdkUrl());
        config.put("endpointId", settings.endpointId());
        // The page shows what the server will actually charge
        config.put("amount", settings.orderAmount());
        config.put("currency", settings.orderCurrency());

        try {
            config.put("ephemeralTicket", paynet.ephemeralTicket());
        } catch (GatewayException e) {
            // This has to stay valid JavaScript whatever happened upstream, or the page cannot
            // even tell the payer that it did. checkout.js reads the absent ticket as terminal.
            LOG.error("[error] {}", e.getMessage());
            config.put("error", e.getMessage());
        }
        return configJs(config);
    }

    /** The 3DS return page needs no ticket: there is no card on it to tokenize. */
    @GetMapping("/result-config.js")
    ResponseEntity<byte[]> resultConfigJs() {
        Map<String, String> config = new LinkedHashMap<>();
        config.put("basePath", settings.basePath());
        config.put("amount", settings.orderAmount());
        config.put("currency", settings.orderCurrency());
        return configJs(config);
    }

    /** Step 3. The browser has exchanged the card for a token; start the payment. */
    @PostMapping("/pay")
    ResponseEntity<Map<String, Object>> pay(@RequestBody PaymentRequest payment, HttpServletRequest request)
            throws GatewayException {

        String token = text(payment.hostedFieldsToken());
        if (token.isEmpty()) {
            return error(HttpStatus.BAD_REQUEST, "hostedFieldsToken is required");
        }

        String clientOrderId = newClientOrderId();
        Map<String, Object> sale = paynet.createSale(
                token,
                clientOrderId,
                clientIp(request),
                browserParams(payment.browser(), request),
                CustomerRequest.of(payment.customer()));

        sale.put("clientOrderId", clientOrderId);
        return ResponseEntity.ok(sale);
    }

    /** Step 4. The page polls this until the order reaches a final status. */
    @GetMapping("/status")
    ResponseEntity<Map<String, Object>> status(
            @RequestParam(required = false) @Nullable String orderId,
            @RequestParam(required = false) @Nullable String clientOrderId)
            throws GatewayException {

        if (text(orderId).isEmpty() || text(clientOrderId).isEmpty()) {
            return error(HttpStatus.BAD_REQUEST, "orderId and clientOrderId are required");
        }
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(paynet.status(text(orderId), text(clientOrderId)));
    }

    /**
     * Step 5. Where the gateway returns the payer after a 3DS challenge, with a POST. It is not a
     * page, because a page cannot be delivered by POST and still be reloadable: the signature is
     * checked here and the payer is sent on to /result with the same signed parameters in the
     * query. The browser carries them, but it cannot forge them — it does not know
     * MERCHANT_CONTROL — and /result checks them again before it serves anything.
     *
     * <p>The body is parsed here rather than read through {@code @RequestParam}, which the servlet
     * container fills from the query string as well: the four values that are verified and the
     * four that are forwarded have to be the same four.
     */
    @PostMapping("/result/callback")
    ResponseEntity<String> resultCallback(@RequestBody(required = false) @Nullable String body) {
        Map<String, String> form = formParams(body);
        if (!Control.valid(form, settings.merchantControl())) {
            LOG.error("[error] callback signature mismatch for order \"{}\"", form.getOrDefault("orderid", ""));
            return plain(HttpStatus.FORBIDDEN, "invalid callback signature");
        }
        return seeOther(form);
    }

    /** A GET here is nobody arriving from a payment; send them to the empty page. */
    @GetMapping("/result/callback")
    ResponseEntity<String> resultCallbackGet() {
        return seeOther(Map.of());
    }

    /**
     * The 3DS return page. The callback carries the outcome too, but the documentation says not to
     * treat it as the status — the page looks the order up over the API instead.
     */
    @GetMapping("/result")
    ResponseEntity<byte[]> result(HttpServletRequest request) {
        // The query is only there when the payer came through the callback. Rechecking it here is
        // what stops a hand-edited URL: without it the page would happily poll somebody else's
        // order. No query at all is fine — the page then says there is nothing to show.
        Map<String, String> query = formParams(request.getQueryString());
        if (!query.getOrDefault("orderid", "").isEmpty() && !Control.valid(query, settings.merchantControl())) {
            LOG.error("[error] result signature mismatch for order \"{}\"", query.get("orderid"));
            return ResponseEntity.status(HttpStatus.FORBIDDEN)
                    .header(HttpHeaders.CONTENT_TYPE, "text/plain; charset=utf-8")
                    .body("invalid result signature".getBytes(StandardCharsets.UTF_8));
        }
        return view("result.html");
    }

    /** The stylesheet and the client scripts. The mapping is the allowlist. */
    @GetMapping({"/styles.css", "/checkout.js", "/status.js", "/result.js"})
    ResponseEntity<byte[]> asset(HttpServletRequest request) {
        String uri = request.getRequestURI();
        String name = uri.substring(uri.lastIndexOf('/') + 1);
        String contentType = ASSETS.get(name);
        if (contentType == null) {
            // Unreachable while the mapping above and the map agree, which is the point of both
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok().header(HttpHeaders.CONTENT_TYPE, contentType).body(resource("public/" + name));
    }

    /** Any gateway failure surfaces to the page as one 502 with a message. */
    @ExceptionHandler(GatewayException.class)
    ResponseEntity<Map<String, Object>> failed(GatewayException e) {
        LOG.error("[error] {}", e.getMessage());
        return error(HttpStatus.BAD_GATEWAY, e.getMessage());
    }

    /** A body that is not the JSON this route expects, including no body at all. */
    @ExceptionHandler(HttpMessageNotReadableException.class)
    ResponseEntity<Map<String, Object>> malformed(HttpMessageNotReadableException e) {
        return error(HttpStatus.BAD_REQUEST, "malformed request body");
    }

    /** What the page sends to /pay. Every field is optional on the wire — the page is a client
     *  like any other — so each is checked rather than trusted. */
    record PaymentRequest(
            @Nullable String hostedFieldsToken,
            @Nullable Map<String, String> browser,
            @Nullable CustomerRequest customer) {}

    record CustomerRequest(
            @Nullable String firstName,
            @Nullable String lastName,
            @Nullable String email,
            @Nullable String cardPrintedName) {

        static Paynet.Customer of(@Nullable CustomerRequest customer) {
            return customer == null
                    ? new Paynet.Customer("", "", "", "")
                    : new Paynet.Customer(
                            text(customer.firstName()),
                            text(customer.lastName()),
                            text(customer.email()),
                            text(customer.cardPrintedName()));
        }
    }

    /**
     * The merchant's own identifier for the order. It is random rather than sequential or
     * clock-based: the page hands it back on every /status poll, so an id that can be guessed would
     * make somebody else's order readable — and two payers in the same millisecond would have
     * collided.
     */
    private static String newClientOrderId() {
        byte[] id = new byte[16];
        RANDOM.nextBytes(id);
        return "hf-" + HexFormat.of().formatHex(id);
    }

    /** Keeps the allowed fields and drops everything else. The last two come from the request
     *  headers, never from the body, so the caller cannot spoof them. */
    private static Map<String, String> browserParams(@Nullable Map<String, String> src, HttpServletRequest request) {
        Map<String, String> browser = new LinkedHashMap<>();
        if (src != null) {
            for (String name : BROWSER_FIELDS) {
                String value = src.get(name);
                if (value != null) {
                    browser.put(name, value);
                }
            }
        }
        browser.put("customer_browser_accept_header", header(request, "Accept", "*/*"));
        browser.put("customer_browser_user_agent", header(request, "User-Agent", ""));
        return browser;
    }

    /**
     * The payer's address, which the platform uses for fraud screening. Behind nginx it only
     * arrives in X-Forwarded-For, so the proxy must set it — and the header is taken on trust,
     * which is one of the reasons the app binds to loopback by default. Exposed straight to the
     * internet this would let any caller pick the address the gateway screens.
     */
    private static String clientIp(HttpServletRequest request) {
        String ip = text(request.getRemoteAddr());
        String forwarded = header(request, "X-Forwarded-For", "");
        if (!forwarded.isEmpty()) {
            // The first entry is the client; everything after it is the proxies it came through
            int next = forwarded.indexOf(',');
            ip = (next < 0 ? forwarded : forwarded.substring(0, next)).strip();
        }
        if (ip.equals("::1")) {
            return "127.0.0.1";
        }
        return ip.startsWith("::ffff:") ? ip.substring("::ffff:".length()) : ip;
    }

    /** The 303 to the result page, carrying the signed parameters it will check again. */
    private ResponseEntity<String> seeOther(Map<String, String> form) {
        // Built by hand rather than with a form encoder, which sorts: every example puts these in
        // the same order, so the URL the payer ends up on is the same one everywhere.
        StringBuilder query = new StringBuilder();
        for (String name : SIGNED_CALLBACK_FIELDS) {
            String value = form.getOrDefault(name, "");
            if (!value.isEmpty()) {
                query.append(query.isEmpty() ? '?' : '&')
                        .append(URLEncoder.encode(name, StandardCharsets.UTF_8))
                        .append('=')
                        .append(URLEncoder.encode(value, StandardCharsets.UTF_8));
            }
        }
        // 303, so the browser follows with a GET whatever it arrived with. The Location is
        // relative: behind a TLS-terminating proxy an absolute one built from this request would
        // send the payer back to http://.
        return ResponseEntity.status(HttpStatus.SEE_OTHER)
                .header(HttpHeaders.LOCATION, settings.basePath() + "/result" + query)
                .build();
    }

    /**
     * Parses an x-www-form-urlencoded body or query string. The first value of a repeated name
     * wins, which is what the checksum is computed over.
     */
    private static Map<String, String> formParams(@Nullable String encoded) {
        Map<String, String> params = new LinkedHashMap<>();
        if (encoded == null || encoded.isEmpty()) {
            return params;
        }
        for (String pair : PAIRS.split(encoded, -1)) {
            int separator = pair.indexOf('=');
            if (separator < 0) {
                continue;
            }
            params.putIfAbsent(
                    URLDecoder.decode(pair.substring(0, separator), StandardCharsets.UTF_8),
                    URLDecoder.decode(pair.substring(separator + 1), StandardCharsets.UTF_8));
        }
        return params;
    }

    /** Both pages are served straight out of the jar, with nothing substituted into them. */
    private ResponseEntity<byte[]> view(String name) {
        return ResponseEntity.ok()
                .headers(securityHeaders())
                .header(HttpHeaders.CONTENT_TYPE, "text/html; charset=utf-8")
                .body(resource("views/" + name));
    }

    /**
     * What a payment page ought to send. The policy is worth reading as part of the example: the
     * card fields are iframes from the gateway, so the SDK host has to be named in frame-src as
     * well as in script-src, and everything else is denied by default.
     *
     * <p>No 'unsafe-inline' anywhere, which is why the result page's script lives in
     * public/result.js rather than in the markup: nothing in views/ is templated, so there is
     * nowhere to put a nonce.
     */
    private HttpHeaders securityHeaders() {
        String policy = String.join(
                "; ",
                "default-src 'none'",
                "script-src 'self' " + settings.sdkOrigin(),
                "style-src 'self'",
                // The three card inputs are cross-origin iframes served by the gateway
                "frame-src " + settings.sdkOrigin(),
                "connect-src 'self' " + settings.sdkOrigin(),
                "img-src 'self' data:",
                "base-uri 'none'",
                "form-action 'self'",
                "frame-ancestors 'none'");

        HttpHeaders headers = new HttpHeaders();
        headers.set("Content-Security-Policy", policy);
        headers.set("X-Content-Type-Options", "nosniff");
        headers.set("Referrer-Policy", "no-referrer");
        // The page carries the signed order parameters in its URL, and it is one payment's page
        headers.set(HttpHeaders.CACHE_CONTROL, "no-store");
        return headers;
    }

    /** window.CONFIG as a script of its own: the only thing this server generates. */
    private static ResponseEntity<byte[]> configJs(Map<String, String> config) {
        byte[] body = ("window.CONFIG = " + JSON.writeValueAsString(config) + ";\n").getBytes(StandardCharsets.UTF_8);
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_TYPE, "text/javascript; charset=utf-8")
                // The ticket inside is single-use, so this must never come from a cache
                .header(HttpHeaders.CACHE_CONTROL, "no-store")
                .body(body);
    }

    private static ResponseEntity<Map<String, Object>> error(HttpStatus status, @Nullable String message) {
        return ResponseEntity.status(status)
                .contentType(MediaType.APPLICATION_JSON)
                .body(Map.<String, Object>of("error", message == null ? "" : message));
    }

    private static ResponseEntity<String> plain(HttpStatus status, String message) {
        return ResponseEntity.status(status)
                .header(HttpHeaders.CONTENT_TYPE, "text/plain; charset=utf-8")
                .body(message);
    }

    /** A file out of the jar: views/ and public/ are packaged in, so there is nothing beside it. */
    private static byte[] resource(String path) {
        try (InputStream in = Routes.class.getClassLoader().getResourceAsStream(path)) {
            if (in == null) {
                throw new IllegalStateException(path + " is not packaged in the jar");
            }
            return in.readAllBytes();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    private static String header(HttpServletRequest request, String name, String fallback) {
        String value = request.getHeader(name);
        return value == null || value.isEmpty() ? fallback : value;
    }

    private static String text(@Nullable String value) {
        return value == null ? "" : value;
    }
}
