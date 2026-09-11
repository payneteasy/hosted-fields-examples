package com.payneteasy.hostedfields

import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.Application
import io.ktor.server.application.ApplicationCall
import io.ktor.server.application.install
import io.ktor.server.plugins.autohead.AutoHeadResponse
import io.ktor.server.plugins.origin
import io.ktor.server.request.queryString
import io.ktor.server.request.receiveText
import io.ktor.server.response.header
import io.ktor.server.response.respond
import io.ktor.server.response.respondBytes
import io.ktor.server.response.respondRedirect
import io.ktor.server.response.respondText
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import io.ktor.server.routing.routing
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.slf4j.LoggerFactory
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.security.SecureRandom
import java.util.HexFormat

private val LOG = LoggerFactory.getLogger("com.payneteasy.hostedfields.Routing")
private val RANDOM = SecureRandom()

/**
 * The stylesheet and the client scripts, with the type each is served as.
 *
 * An allowlist, and it is the only way in: Ktor's `staticResources` is never installed, so views/,
 * the class files and anything else that ever lands on the classpath stay unreachable. This is the
 * counterpart of Spring's `spring.web.resources.add-mappings=false` and of Sinatra's `static`.
 */
private val ASSETS =
    mapOf(
        "styles.css" to "text/css; charset=utf-8",
        "checkout.js" to "text/javascript; charset=utf-8",
        "status.js" to "text/javascript; charset=utf-8",
        "result.js" to "text/javascript; charset=utf-8",
    )

/**
 * The 3DS 2.0 browser data the page collects.
 *
 * A fixed list, and the body is filtered against it rather than merged over the Sale: that is what
 * stops a caller choosing what to charge. The last two come from the request's own headers and are
 * never read from the body.
 */
private val BROWSER_FIELDS =
    listOf(
        "customer_browser_info",
        "customer_browser_javascript_enabled",
        "customer_browser_java_enabled",
        "customer_browser_accept_language",
        "customer_browser_color_depth",
        "customer_browser_screen_width",
        "customer_browser_screen_height",
        "customer_browser_time_zone",
    )

/** Everything this server answers, all of it under BASE_PATH. */
fun Application.module(settings: Settings) {
    val paynet = Paynet(settings)
    val base = settings.basePath

    // HEAD is answered wherever GET is, which a proxy's health check and `curl -I` both expect
    install(AutoHeadResponse)

    routing {
        // Ktor has no context path and, unlike Go's mux and Tomcat, does not redirect the bare
        // prefix to the trailing-slash form by itself. The page is served at `{prefix}/`, which is
        // what the views' relative asset URLs resolve against, and this is the 301 that gets a
        // payer who typed the prefix without it there. IgnoreTrailingSlash is deliberately not
        // installed: it would make the two the same route and every asset URL would then resolve
        // one segment too high.
        get(base) { call.respondRedirect("$base/", permanent = true) }

        // Step 2. The payment page, byte for byte as it is on disk. Nothing here is templated.
        get("$base/") { call.view(settings, "checkout.html") }

        // Step 1. The only generated file in the repository, and the reason the pages need no
        // template engine.
        get("$base/config.js") {
            val config =
                linkedMapOf(
                    "basePath" to settings.basePath,
                    "sdkUrl" to settings.sdkUrl,
                    "endpointId" to settings.endpointId,
                    "amount" to settings.orderAmount,
                    "currency" to settings.orderCurrency,
                )
            try {
                config["ephemeralTicket"] = paynet.ephemeralTicket()
            } catch (e: Exception) {
                // Still valid JavaScript and still a 200: checkout.js tells the payer and kills
                // the button. A 500 here would leave the page with no way to say what went wrong.
                LOG.error("[error] {}", e.message)
                config["error"] = e.message.orEmpty()
            }
            call.configJs(config)
        }

        // The same, for the result page: no SDK to load and no ticket to spend.
        get("$base/result-config.js") {
            call.configJs(
                linkedMapOf(
                    "basePath" to settings.basePath,
                    "amount" to settings.orderAmount,
                    "currency" to settings.orderCurrency,
                ),
            )
        }

        // Step 3. The Sale. The body carries the token the browser was given for the card, the
        // payer's own details and the 3DS browser data — and nothing that decides what is charged.
        post("$base/pay") {
            val body =
                try {
                    Json.parseToJsonElement(call.receiveText()) as JsonObject
                } catch (_: Exception) {
                    call.json(HttpStatusCode.BadRequest, mapOf("error" to "malformed request body"))
                    return@post
                }

            val token = body.text("hostedFieldsToken")
            if (token.isEmpty()) {
                call.json(HttpStatusCode.BadRequest, mapOf("error" to "hostedFieldsToken is required"))
                return@post
            }
            val payer = (body["customer"] as? JsonObject) ?: JsonObject(emptyMap())

            try {
                // Unguessable rather than sequential: this id is what /status is asked with
                val clientOrderId = "hf-" + HexFormat.of().formatHex(ByteArray(16).also { RANDOM.nextBytes(it) })
                val sale =
                    paynet.sale(
                        hostedFieldsToken = token,
                        clientOrderId = clientOrderId,
                        ipAddress = call.clientIp(),
                        browser = call.browserParams(body["browser"] as? JsonObject),
                        payer =
                            Customer(
                                firstName = payer.text("firstName"),
                                lastName = payer.text("lastName"),
                                email = payer.text("email"),
                                cardPrintedName = payer.text("cardPrintedName"),
                            ),
                    )
                // The page polls /status with both ids, so the one this server made goes back with
                // the gateway's reply rather than beside it.
                call.json(HttpStatusCode.OK, JsonObject(sale + ("clientOrderId" to JsonPrimitive(clientOrderId))))
            } catch (e: Exception) {
                call.fail(e)
            }
        }

        // Step 4. Where the order stands, polled by the page until it settles.
        get("$base/status") {
            val orderId = call.request.queryParameters["orderId"].orEmpty()
            val clientOrderId = call.request.queryParameters["clientOrderId"].orEmpty()
            if (orderId.isEmpty() || clientOrderId.isEmpty()) {
                call.json(HttpStatusCode.BadRequest, mapOf("error" to "orderId and clientOrderId are required"))
                return@get
            }
            try {
                val status = paynet.status(orderId, clientOrderId)
                // The page asks again a second later; a cached answer would be the old one
                call.response.header(HttpHeaders.CacheControl, "no-store")
                call.json(HttpStatusCode.OK, status)
            } catch (e: Exception) {
                call.fail(e)
            }
        }

        // Step 5. Where the gateway returns the payer after a 3DS challenge, with a POST. It is
        // not a page, because a page cannot be delivered by POST and still be reloadable: the
        // signature is checked here and the payer is sent on to /result with the same signed
        // parameters in the query.
        post("$base/result/callback") {
            // Parsed off the body by hand rather than through call.receiveParameters(), so that
            // the four values verified are provably the four forwarded.
            val form = formParams(call.receiveText())
            if (!Control.valid(form, settings.merchantControl)) {
                LOG.error("[error] callback signature mismatch for order \"{}\"", form["orderid"].orEmpty())
                call.respondText("invalid callback signature", ContentType.Text.Plain, HttpStatusCode.Forbidden)
                return@post
            }
            call.seeOther(base, form)
        }

        // The gateway POSTs, but a payer who reloads or comes back arrives with a GET. There is no
        // body to verify then, so there is nothing to forward either and /result says as much.
        get("$base/result/callback") { call.seeOther(base, emptyMap()) }

        // Step 6. The result page, and the second check of the same checksum.
        get("$base/result") {
            val query = formParams(call.request.queryString())
            if (query["orderid"].orEmpty().isNotEmpty() && !Control.valid(query, settings.merchantControl)) {
                LOG.error("[error] result signature mismatch for order \"{}\"", query["orderid"].orEmpty())
                call.respondText("invalid result signature", ContentType.Text.Plain, HttpStatusCode.Forbidden)
                return@get
            }
            call.view(settings, "result.html")
        }

        // The four files of the browser half, each at its own route. The map is the allowlist.
        for ((name, contentType) in ASSETS) {
            get("$base/$name") {
                call.respondBytes(resource("public/$name"), ContentType.parse(contentType))
            }
        }
    }
}

/** A file out of the jar: views/ and public/ are packaged in, so there is nothing beside it. */
private fun resource(path: String): ByteArray =
    Settings::class.java.classLoader
        .getResourceAsStream(path)
        ?.use { it.readBytes() }
        ?: error("$path is not packaged in the jar")

/** Both pages are served straight out of the jar, with nothing substituted into them. */
private suspend fun ApplicationCall.view(
    settings: Settings,
    name: String,
) {
    securityHeaders(settings)
    respondBytes(resource("views/$name"), ContentType.parse("text/html; charset=utf-8"))
}

/**
 * What the two pages ship with.
 *
 * The policy has no `'unsafe-inline'`, which is why the result page's script is a file of its own
 * rather than a `<script>` in the markup — a nonce could not go there, because nothing in views/
 * is templated. It names the SDK's origin in script-src and in frame-src both: the card fields are
 * iframes from that host.
 */
private fun ApplicationCall.securityHeaders(settings: Settings) {
    val policy =
        listOf(
            "default-src 'none'",
            "script-src 'self' ${settings.sdkOrigin}",
            "style-src 'self'",
            "frame-src ${settings.sdkOrigin}",
            "connect-src 'self' ${settings.sdkOrigin}",
            "img-src 'self' data:",
            "base-uri 'none'",
            "form-action 'self'",
            "frame-ancestors 'none'",
        ).joinToString("; ")
    response.header("Content-Security-Policy", policy)
    response.header("X-Content-Type-Options", "nosniff")
    response.header("Referrer-Policy", "no-referrer")
    response.header(HttpHeaders.CacheControl, "no-store")
}

/** window.CONFIG as a script of its own: the only thing this server generates. */
private suspend fun ApplicationCall.configJs(config: Map<String, String>) {
    val body = "window.CONFIG = " + JsonObject(config.mapValues { JsonPrimitive(it.value) }) + ";\n"
    // The ticket inside is single-use, so this must never come from a cache
    response.header(HttpHeaders.CacheControl, "no-store")
    respondText(body, ContentType.parse("text/javascript; charset=utf-8"))
}

private suspend fun ApplicationCall.json(
    status: HttpStatusCode,
    body: Map<String, String>,
) = json(status, JsonObject(body.mapValues { JsonPrimitive(it.value) }))

private suspend fun ApplicationCall.json(
    status: HttpStatusCode,
    body: JsonObject,
) {
    respondText(body.toString(), ContentType.Application.Json, status)
}

/** Every gateway failure reaches the page the same way, as one 502 with the reason in it. */
private suspend fun ApplicationCall.fail(e: Exception) {
    LOG.error("[error] {}", e.message)
    json(HttpStatusCode.BadGateway, mapOf("error" to e.message.orEmpty()))
}

/**
 * The 303 on to /result, with the signed parameters in the query.
 *
 * Built by hand rather than with a form encoder, which sorts: every example puts these in the same
 * order, so the URL the payer ends up on is the same one everywhere. The Location is relative —
 * behind a TLS-terminating proxy an absolute one built from this request would send the payer back
 * to http://. 303, so the browser follows with a GET whatever it arrived with.
 */
private suspend fun ApplicationCall.seeOther(
    base: String,
    form: Map<String, String>,
) {
    val signed =
        Control.SIGNED_FIELDS
            .mapNotNull { name -> form[name]?.takeIf { it.isNotEmpty() }?.let { name to it } }
            .joinToString("&") { (name, value) -> "${encodeQuery(name)}=${encodeQuery(value)}" }
    response.header(HttpHeaders.Location, "$base/result" + if (signed.isEmpty()) "" else "?$signed")
    respond(HttpStatusCode.SeeOther)
}

private fun encodeQuery(value: String) = java.net.URLEncoder.encode(value, StandardCharsets.UTF_8)

/**
 * Parses an x-www-form-urlencoded body or query string. The first value of a repeated name wins,
 * which is what the checksum is computed over.
 */
private fun formParams(encoded: String?): Map<String, String> {
    val params = LinkedHashMap<String, String>()
    if (encoded.isNullOrEmpty()) return params
    for (pair in encoded.split("&")) {
        val separator = pair.indexOf('=')
        if (separator < 0) continue
        params.putIfAbsent(
            URLDecoder.decode(pair.substring(0, separator), StandardCharsets.UTF_8),
            URLDecoder.decode(pair.substring(separator + 1), StandardCharsets.UTF_8),
        )
    }
    return params
}

/** The eight fields off the body, and the two that are only ever the request's own. */
private fun ApplicationCall.browserParams(src: JsonObject?): Map<String, String> {
    val browser = LinkedHashMap<String, String>()
    for (name in BROWSER_FIELDS) {
        val value = src?.get(name) ?: continue
        if (value is JsonPrimitive && value !is JsonNull) browser[name] = value.content
    }
    browser["customer_browser_accept_header"] = request.headers[HttpHeaders.Accept].orEmpty().ifEmpty { "*/*" }
    browser["customer_browser_user_agent"] = request.headers[HttpHeaders.UserAgent].orEmpty()
    return browser
}

/**
 * The payer's address, for the platform's fraud screening.
 *
 * X-Forwarded-For is taken on trust, which is only safe with a proxy in front — hence the loopback
 * default in .env.example. The first element is the one nginx puts the client's address in.
 */
private fun ApplicationCall.clientIp(): String {
    val forwarded = request.headers["X-Forwarded-For"].orEmpty()
    val address = if (forwarded.isNotEmpty()) forwarded.split(",")[0].trim() else request.origin.remoteAddress
    if (address == "::1") return "127.0.0.1"
    return address.removePrefix("::ffff:")
}

/** One field of a JSON object as text, treating a missing one and a null one alike. */
private fun JsonObject.text(name: String): String {
    val value = this[name]
    if (value !is JsonPrimitive || value is JsonNull) return ""
    return value.content
}
