package com.payneteasy.hostedfields

import java.net.URI
import java.nio.file.Files
import java.nio.file.Path
import java.security.interfaces.RSAPrivateKey

/**
 * Everything the server needs, read once and validated before anything else exists.
 *
 * A data class prints every property, and one of these is the private key: anything that logs a
 * Settings — a stack trace, a debug line — would otherwise put the key in the log. Hence the
 * [toString] below.
 */
data class Settings(
    val port: String,
    val listenAddr: String,
    val basePath: String,
    val publicUrl: String,
    val apiUrl: String,
    val sdkUrl: String,
    val sdkOrigin: String,
    val endpointId: String,
    val merchantLogin: String,
    val merchantControl: String,
    val orderAmount: String,
    val orderCurrency: String,
    val privateKey: RSAPrivateKey,
) {
    /** Where the gateway sends the payer back after a 3DS challenge. */
    val redirectUrl: String get() = publicUrl + basePath + "/result/callback"

    override fun toString() = "Settings(basePath=$basePath, publicUrl=$publicUrl, apiUrl=$apiUrl)"

    companion object {
        /**
         * The real environment first, then `.env`, then the fallback.
         *
         * This is called from `main`, before the engine is built, so the process refuses to start
         * on a missing credential rather than serving a payment page that cannot take a payment —
         * and so `./gradlew build` needs no credentials, because nothing is validated at class
         * initialisation.
         */
        fun load(envFile: Path): Settings {
            val file = readEnvFile(envFile)

            val port = env(file, "PORT", "3009")
            val apiUrl = env(file, "API_URL", "")
            val sdkUrl = env(file, "SDK_URL", "")
            val settings =
                Settings(
                    port = port,
                    // Loopback by default: the example speaks plain HTTP and trusts X-Forwarded-For,
                    // both of which are only safe with a proxy in front.
                    listenAddr = env(file, "LISTEN_ADDR", "127.0.0.1"),
                    basePath = env(file, "BASE_PATH", "/hosted-fields-examples-kotlin"),
                    // Computed after the port, so the fallback names the port actually in use
                    publicUrl = env(file, "PUBLIC_URL", "http://localhost:$port"),
                    apiUrl = apiUrl,
                    sdkUrl = sdkUrl,
                    sdkOrigin = origin(sdkUrl),
                    endpointId = env(file, "ENDPOINT_ID", ""),
                    merchantLogin = env(file, "MERCHANT_LOGIN", ""),
                    merchantControl = env(file, "MERCHANT_CONTROL", ""),
                    orderAmount = env(file, "ORDER_AMOUNT", "1.00"),
                    orderCurrency = env(file, "ORDER_CURRENCY", "USD"),
                    privateKey = OAuth.parsePrivateKey(readPrivateKey(file)),
                )

            // The five without a default. A stale gateway host baked in here would silently point
            // a real payment somewhere it does not belong, so there is nothing to fall back to.
            val required =
                linkedMapOf(
                    "API_URL" to settings.apiUrl,
                    "SDK_URL" to settings.sdkUrl,
                    "ENDPOINT_ID" to settings.endpointId,
                    "MERCHANT_LOGIN" to settings.merchantLogin,
                    "MERCHANT_CONTROL" to settings.merchantControl,
                )
            for ((name, value) in required) {
                check(value.isNotEmpty()) { "$name is not set, see .env.example" }
            }
            return settings
        }

        /** The card fields are iframes from this origin, and the page's CSP has to name it. */
        private fun origin(sdkUrl: String): String {
            val parsed = runCatching { URI(sdkUrl) }.getOrNull() ?: return ""
            val scheme = parsed.scheme ?: return ""
            val authority = parsed.authority ?: return ""
            return "$scheme://$authority"
        }

        /** One setting. An empty value counts as unset, so a copied .env.example fails with a
         *  message naming what is missing rather than half working. */
        private fun env(
            file: Map<String, String>,
            name: String,
            fallback: String,
        ): String {
            val value =
                System.getenv(name).takeUnless { it.isNullOrEmpty() }
                    ?: file[name].takeUnless { it.isNullOrEmpty() }
            return value ?: fallback
        }

        private fun readPrivateKey(file: Map<String, String>): String {
            val path = env(file, "PRIVATE_KEY_PATH", "")
            if (path.isNotEmpty()) {
                val key = Path.of(path)
                check(Files.isReadable(key)) { "cannot read the private key at $path" }
                return Files.readString(key)
            }
            val inline = env(file, "PRIVATE_KEY", "")
            check(inline.isNotEmpty()) { "set PRIVATE_KEY_PATH or PRIVATE_KEY, see .env.example" }
            return inline
        }

        /**
         * A `node --env-file` lookalike, because the JVM has no such switch either. A missing file
         * is not an error — the settings can all come from the environment, which is how the
         * containers and the e2e suite pass them.
         */
        private fun readEnvFile(path: Path): Map<String, String> {
            if (!Files.isReadable(path)) return emptyMap()
            val values = mutableMapOf<String, String>()
            for (raw in Files.readAllLines(path)) {
                val line = raw.trim()
                if (line.isEmpty() || line.startsWith("#")) continue
                val separator = line.indexOf('=')
                if (separator < 0) continue
                val name = line.substring(0, separator).trim()
                val value = line.substring(separator + 1).trim().trim('"', '\'')
                values[name] = value
            }
            return values
        }
    }
}
