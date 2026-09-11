package com.payneteasy.hostedfields;

// The three gateway calls the Hosted Fields flow needs.
// https://doc.payneteasy.com/integration/api_use_cases/hosted_fields.html

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import tools.jackson.core.JacksonException;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

/** The gateway, as this example uses it. A decoded reply is a loose map: keys are the documented
 *  kebab-case names, and values are mostly strings but not always — error-code is a number in a
 *  sale reply, and a typed class would turn that into a parse failure on a good answer. */
final class Paynet {

    private static final Logger LOG = LoggerFactory.getLogger(Paynet.class);

    private static final TypeReference<Map<String, Object>> REPLY = new TypeReference<>() {};

    /** Our own mapper rather than the one Spring configures for the controllers: what the gateway
     *  sends and what this app answers are two different contracts, and neither should be able to
     *  move the other by a setting. */
    private static final ObjectMapper JSON = new ObjectMapper();

    /** Both halves of the timeout are named: connectTimeout does not cover waiting for the reply,
     *  and the one left out waits forever — which means the payer's page does too. */
    private static final HttpClient GATEWAY =
            HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(30)).build();

    private final Settings settings;
    private final OAuth oauth;

    Paynet(Settings settings) {
        this.settings = settings;
        this.oauth = new OAuth(settings);
    }

    /** Payer details collected by our own inputs, next to the card iframes. The card holder name
     *  is composed by the page from the first two: the hosted fields token does not carry it, and
     *  with the token the platform leaves the holder empty unless it is sent here — which some
     *  acquirers do not survive. */
    record Customer(String firstName, String lastName, String email, String cardPrintedName) {}

    /**
     * A single-use ticket the browser exchanges for a hosted fields token. It is valid for 15
     * minutes and safe to put on the page.
     */
    String ephemeralTicket() throws GatewayException {
        Map<String, Object> decoded = postJson("/api/v4/tokenize/create-ephemeral-ticket/", Map.of());
        Object ticket = decoded.get("ephemeralTicket");
        if (ticket instanceof String text && !text.isBlank()) {
            return text.strip();
        }
        // A rejected request comes back as 4xx with a JSON body carrying the reason. Only that one
        // field is quoted: this reason travels on into config.js, where the browser can read it,
        // and the rest of the reply is the gateway's business and not the payer's.
        if (decoded.get("error-message") instanceof String message && !message.isEmpty()) {
            throw new GatewayException("no ephemeralTicket: " + message);
        }
        throw new GatewayException("no ephemeralTicket in the response");
    }

    /**
     * Charges the card behind the hosted fields token. The token replaces credit_card_number,
     * expire_month, expire_year and cvv2 — sending those is an error.
     */
    Map<String, Object> createSale(
            String hostedFieldsToken,
            String clientOrderId,
            String ipAddress,
            Map<String, String> browser,
            Customer payer)
            throws GatewayException {

        Map<String, String> params = new LinkedHashMap<>();
        params.put("client_orderid", clientOrderId);
        params.put("order_desc", "Hosted Fields example order");
        params.put("amount", settings.orderAmount());
        params.put("currency", settings.orderCurrency());
        params.put("hosted_fields_token", hostedFieldsToken);
        params.put("card_printed_name", payer.cardPrintedName());
        params.put("first_name", payer.firstName());
        params.put("last_name", payer.lastName());
        params.put("address1", "100 Main st");
        params.put("city", "Seattle");
        params.put("zip_code", "98102");
        params.put("country", "US");
        params.put("state", "WA");
        params.put("phone", "+12063582043");
        params.put("email", payer.email());
        params.put("ipaddress", ipAddress);
        params.put("redirect_url", settings.redirectUrl());

        // 3DS 2.0 browser data, required by /api/v4/sale. It comes from the page, so a parameter
        // the server has already set is never taken from it: Routes filters the body to the
        // documented keys and putIfAbsent refuses to overwrite, so neither guard is load-bearing
        // on its own.
        browser.forEach(params::putIfAbsent);

        return postJson("/api/v4/sale/", params);
    }

    /** Polled until the order reaches a final status. */
    Map<String, Object> status(String orderId, String clientOrderId) throws GatewayException {
        return postJson(
                "/api/v4/status/",
                Map.of(
                        "login", settings.merchantLogin(),
                        "client_orderid", clientOrderId,
                        "orderid", orderId));
    }

    /**
     * Sends a signed command and decodes the reply. A rejected request — a validation error or a
     * decline — comes back as 4xx with a JSON body, so the body is decoded whatever the status: it
     * carries the error-message for the page. Only a reply that is not JSON at all counts as a
     * failure of the call itself.
     *
     * <p>{@code java.net.http} does not throw on a 4xx, so nothing special is needed to let one
     * through — unlike Python's urlopen, which raises and has to be unwound.
     */
    private Map<String, Object> postJson(String command, Map<String, String> params) throws GatewayException {
        String endpoint = settings.apiUrl() + command + settings.endpointId();
        HttpResponse<String> reply = post(endpoint, params);
        try {
            return JSON.readValue(reply.body(), REPLY);
        } catch (JacksonException e) {
            // The body is not quoted: it reaches the page as {error}. The log line above has it.
            throw new GatewayException("gateway request failed with " + reply.statusCode());
        }
    }

    private HttpResponse<String> post(String endpoint, Map<String, String> params) throws GatewayException {
        HttpRequest request = HttpRequest.newBuilder(URI.create(endpoint))
                .timeout(Duration.ofSeconds(30))
                .header("Content-Type", "application/x-www-form-urlencoded")
                // Ask for JSON instead of the default x-www-form-urlencoded reply.
                // https://doc.payneteasy.com/integration/openapi.html
                .header("Accept", "application/vnd.pay+json")
                .header("Authorization", oauth.authHeader("POST", endpoint, params))
                .POST(HttpRequest.BodyPublishers.ofString(formEncode(params), StandardCharsets.UTF_8))
                .build();

        HttpResponse<String> reply;
        try {
            reply = GATEWAY.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        } catch (IOException e) {
            throw new GatewayException("cannot reach the gateway: " + reason(e), e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new GatewayException("the gateway call was interrupted", e);
        }
        LOG.info("[paynet] POST {} -> {}{}", endpoint, reply.statusCode(), logReason(reply.body()));
        return reply;
    }

    /**
     * Why a call failed, in words the payer's page can be shown — this one travels into config.js.
     * The message of the deepest cause, because the outer exception of a connection failure often
     * has none at all, and "cannot reach the gateway: null" says nothing to anybody.
     */
    private static String reason(Throwable e) {
        Throwable root = e;
        while (root.getCause() != null) {
            root = root.getCause();
        }
        String message = root.getMessage();
        return message == null || message.isBlank() ? root.getClass().getSimpleName() : message.strip();
    }

    /**
     * The request body, which <em>is</em> form encoding — a space is {@code +} here. The signature
     * over the same parameters is not: see {@link OAuth#encode}. The asymmetry is deliberate and
     * both halves are required.
     */
    private static String formEncode(Map<String, String> params) {
        return params.entrySet().stream()
                .map(pair -> URLEncoder.encode(pair.getKey(), StandardCharsets.UTF_8)
                        + "="
                        + URLEncoder.encode(pair.getValue(), StandardCharsets.UTF_8))
                .collect(Collectors.joining("&"));
    }

    /**
     * What goes in the log beside the status code. Not the body: a status reply carries the card's
     * last four digits and the holder's name, and the ticket reply carries the ticket. The gateway
     * puts everything a log needs to be useful into these two fields anyway.
     */
    static String logReason(String body) {
        Map<String, Object> decoded;
        try {
            decoded = JSON.readValue(body, REPLY);
        } catch (JacksonException e) {
            return " (reply is not JSON)";
        }

        StringBuilder reason = new StringBuilder();
        String id = logField(decoded, "paynet-order-id");
        if (!id.isEmpty()) {
            reason.append(" order ").append(id);
        }
        String message = logField(decoded, "error-message");
        if (!message.isEmpty()) {
            reason.append(' ').append(message);
        }
        return reason.toString();
    }

    /** One value of a decoded reply as text, whatever JSON type it arrived as. The gateway answers
     *  paynet-order-id as a number in a sale reply and as a string elsewhere, and Jackson keeps a
     *  whole number a Long, so a long id keeps its digits instead of turning into exponent form. */
    private static String logField(Map<String, Object> decoded, String name) {
        Object value = decoded.get(name);
        return value == null ? "" : oneLine(String.valueOf(value));
    }

    private static String oneLine(String text) {
        return String.join(" ", text.split("\\s+")).strip();
    }
}
