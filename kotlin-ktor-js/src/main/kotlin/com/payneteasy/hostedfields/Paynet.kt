package com.payneteasy.hostedfields

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.slf4j.LoggerFactory
import java.net.URI
import java.net.URLEncoder
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.nio.charset.StandardCharsets
import java.time.Duration

/** A gateway call that did not come back as JSON at all. Every one of these becomes a 502. */
class GatewayException(
    message: String,
) : RuntimeException(message)

/** The payer's own details, as the page collected them. */
data class Customer(
    val firstName: String,
    val lastName: String,
    val email: String,
    val cardPrintedName: String,
)

/** The three calls this example makes to the gateway. */
class Paynet(
    private val settings: Settings,
) {
    private val oauth = OAuth(settings.merchantLogin, settings.privateKey)

    // One client for the process. java.net.http rather than a Ktor client: the integration needs
    // nothing the JDK does not already have.
    private val http: HttpClient =
        HttpClient
            .newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .build()

    /**
     * Step 1. The short-lived ticket the browser needs before it may tokenize a card.
     *
     * It arrives as JSON with everything else, under `ephemeralTicket`.
     */
    suspend fun ephemeralTicket(): String {
        val decoded = postJson("/api/v4/tokenize/create-ephemeral-ticket/", emptyMap())
        val ticket = (decoded["ephemeralTicket"] as? JsonPrimitive)?.content.orEmpty().trim()
        if (ticket.isEmpty()) {
            val message = (decoded["error-message"] as? JsonPrimitive)?.content.orEmpty()
            throw GatewayException(
                if (message.isNotEmpty()) "no ephemeralTicket: $message" else "no ephemeralTicket in the response",
            )
        }
        return ticket
    }

    /**
     * Step 3. The Sale, with the token the browser got in exchange for the card.
     *
     * Every parameter that decides what is charged is the server's. The browser data is filtered
     * before it reaches here and cannot overwrite one of them: see [browserParams].
     */
    suspend fun sale(
        hostedFieldsToken: String,
        clientOrderId: String,
        ipAddress: String,
        browser: Map<String, String>,
        payer: Customer,
    ): JsonObject {
        val params =
            linkedMapOf(
                "client_orderid" to clientOrderId,
                "order_desc" to "Hosted Fields example order",
                "amount" to settings.orderAmount,
                "currency" to settings.orderCurrency,
                "hosted_fields_token" to hostedFieldsToken,
                "card_printed_name" to payer.cardPrintedName,
                "first_name" to payer.firstName,
                "last_name" to payer.lastName,
                // Demo data. A shop sends the payer's real billing address.
                "address1" to "100 Main st",
                "city" to "Seattle",
                "zip_code" to "98102",
                "country" to "US",
                "state" to "WA",
                "phone" to "+12063582043",
                "email" to payer.email,
                "ipaddress" to ipAddress,
                "redirect_url" to settings.redirectUrl,
            )
        // The 3DS 2.0 browser data, written after the parameters above rather than merged over
        // them: a caller naming `amount` would otherwise choose what to charge.
        for ((name, value) in browser) {
            params.putIfAbsent(name, value)
        }
        return postJson("/api/v4/sale/", params)
    }

    /** Step 4. Where the order stands, asked once per poll from the page. */
    suspend fun status(
        orderId: String,
        clientOrderId: String,
    ): JsonObject =
        postJson(
            "/api/v4/status/",
            linkedMapOf(
                "login" to settings.merchantLogin,
                "client_orderid" to clientOrderId,
                "orderid" to orderId,
            ),
        )

    /**
     * One signed call, decoded.
     *
     * The body is decoded whatever the status: a rejected request comes back as 4xx **with** a
     * JSON body carrying `error-message`, and that is a decline rather than a failed call. Only a
     * reply that is not JSON at all is a failure.
     */
    private suspend fun postJson(
        command: String,
        params: Map<String, String>,
    ): JsonObject {
        val (body, status) = post(command, params)
        return try {
            JSON.parseToJsonElement(body) as JsonObject
        } catch (e: Exception) {
            // The body is deliberately not quoted into the message: it reaches the page
            throw GatewayException("gateway request failed with $status").also { it.addSuppressed(e) }
        }
    }

    private suspend fun post(
        command: String,
        params: Map<String, String>,
    ): Pair<String, Int> {
        val endpoint = settings.apiUrl + command + settings.endpointId
        val request =
            HttpRequest
                .newBuilder(URI.create(endpoint))
                .timeout(Duration.ofSeconds(30))
                .header("Content-Type", "application/x-www-form-urlencoded")
                // Ask for JSON instead of the default x-www-form-urlencoded reply.
                // https://doc.payneteasy.com/integration/openapi.html
                .header("Accept", "application/vnd.pay+json")
                .header("Authorization", oauth.authHeader("POST", endpoint, params))
                .POST(HttpRequest.BodyPublishers.ofString(formEncode(params), StandardCharsets.UTF_8))
                .build()

        // java.net.http's send is blocking, and a Ktor handler runs on a Netty event-loop thread:
        // blocking one of those stalls every other request the server is serving.
        val response =
            withContext(Dispatchers.IO) {
                http.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8))
            }
        LOG.info("[paynet] POST {} -> {}{}", endpoint, response.statusCode(), logReason(response.body()))
        return response.body() to response.statusCode()
    }

    companion object {
        private val LOG = LoggerFactory.getLogger(Paynet::class.java)
        private val JSON = Json

        /**
         * The request body, which *is* form encoding — a space is `+` here. The signature over the
         * same parameters is not: see [OAuth.encode]. Both halves are required.
         */
        fun formEncode(params: Map<String, String>): String =
            params.entries.joinToString("&") { (key, value) ->
                URLEncoder.encode(key, StandardCharsets.UTF_8) + "=" + URLEncoder.encode(value, StandardCharsets.UTF_8)
            }

        /**
         * What may be logged about a reply: the order id and, if there is one, the reason.
         *
         * Nothing else — the body carries the cardholder, the masked card and the ticket, and a
         * log file is not where any of those belong.
         */
        fun logReason(body: String): String {
            val decoded =
                try {
                    JSON.parseToJsonElement(body) as JsonObject
                } catch (_: Exception) {
                    return " (reply is not JSON)"
                }
            val orderId = field(decoded, "paynet-order-id")
            val message = field(decoded, "error-message")
            return (if (orderId.isEmpty()) "" else " order $orderId") + (if (message.isEmpty()) "" else " $message")
        }

        /** One field as text. A JSON number keeps its digits: an order id is not a float. */
        private fun field(
            decoded: JsonObject,
            name: String,
        ): String {
            val value = decoded[name] as? JsonPrimitive ?: return ""
            return oneLine(value.content)
        }

        /** A log line is one line: a multi-line reason from the gateway becomes one. */
        private fun oneLine(value: String) = value.split(Regex("\\s+")).filter { it.isNotEmpty() }.joinToString(" ")
    }
}
