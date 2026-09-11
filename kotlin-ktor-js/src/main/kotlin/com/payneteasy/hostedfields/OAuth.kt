package com.payneteasy.hostedfields

import java.nio.charset.StandardCharsets
import java.security.GeneralSecurityException
import java.security.KeyFactory
import java.security.SecureRandom
import java.security.Signature
import java.security.interfaces.RSAPrivateKey
import java.security.spec.PKCS8EncodedKeySpec
import java.util.Base64
import java.util.HexFormat

/**
 * OAuth 1.0a request signing, RSA-SHA256.
 *
 * https://doc.payneteasy.com/integration/general_api_usage/request_authentication_methods/oauth.html
 */
class OAuth(
    private val consumerKey: String,
    private val privateKey: RSAPrivateKey,
) {
    /** The Authorization header for one request. The parameters are the form body's. */
    fun authHeader(
        method: String,
        endpoint: String,
        params: Map<String, String>,
    ): String {
        val nonce = ByteArray(16).also { RANDOM.nextBytes(it) }

        val oauth =
            sortedMapOf(
                "oauth_consumer_key" to consumerKey,
                "oauth_nonce" to HexFormat.of().formatHex(nonce),
                "oauth_signature_method" to "RSA-SHA256",
                "oauth_timestamp" to (System.currentTimeMillis() / 1000).toString(),
                "oauth_version" to "1.0",
            )

        // The signature covers the request parameters and the oauth ones together; oauth wins a
        // collision, and oauth_signature itself is added afterwards.
        val signed =
            sortedMapOf<String, String>().apply {
                putAll(params)
                putAll(oauth)
            }
        oauth["oauth_signature"] = sign(baseString(method, endpoint, signed))

        // Header values are not encoded by the transport, so encode them here
        return "OAuth " + oauth.entries.joinToString(", ") { (key, value) -> "$key=\"${encode(value)}\"" }
    }

    private fun sign(baseString: String): String =
        try {
            val rsa = Signature.getInstance("SHA256withRSA")
            rsa.initSign(privateKey)
            rsa.update(baseString.toByteArray(StandardCharsets.UTF_8))
            Base64.getEncoder().encodeToString(rsa.sign())
        } catch (e: GeneralSecurityException) {
            throw IllegalStateException("cannot sign the request: ${e.message}", e)
        }

    companion object {
        private val RANDOM = SecureRandom()

        /**
         * RFC 3986 percent encoding.
         *
         * Not `URLEncoder.encode` and not Ktor's `encodeURLParameter`, both of which are form
         * encoding: they write a space as `+` and leave `!'()*` alone, and the gateway then
         * answers a bare 401 with nothing in the reply to say why. The request *body* is form
         * encoded — see [Paynet.formEncode] — and the asymmetry is deliberate.
         */
        fun encode(value: String): String {
            val unreserved = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~"
            val out = StringBuilder()
            // Per byte of the UTF-8 form, not per character: a non-ASCII character is several
            // bytes and each one is escaped on its own.
            for (b in value.toByteArray(StandardCharsets.UTF_8)) {
                if (unreserved.indexOf(b.toInt().toChar()) >= 0) {
                    out.append(b.toInt().toChar())
                } else {
                    out.append('%').append(HexFormat.of().withUpperCase().toHexDigits(b))
                }
            }
            return out.toString()
        }

        /** The signature base string: METHOD&url&sorted-parameters, each part percent-encoded. */
        fun baseString(
            method: String,
            endpoint: String,
            params: Map<String, String>,
        ): String = method.uppercase() + "&" + encode(endpoint) + "&" + encode(normalize(params))

        /** The parameters, sorted by name and joined the way the base string wants them. */
        fun normalize(params: Map<String, String>): String =
            params.toSortedMap().entries.joinToString("&") { (key, value) -> "${encode(key)}=${encode(value)}" }

        /**
         * The RSA key the gateway issued, PKCS#8. `\n` written out is accepted so the key can
         * arrive as a single-line environment variable.
         */
        fun parsePrivateKey(text: String): RSAPrivateKey {
            val pem = text.replace("\\n", "\n").trim()
            check(!pem.contains("BEGIN RSA PRIVATE KEY")) {
                "the private key is PKCS#1 and the JDK reads PKCS#8 only, convert it with:" +
                    " openssl pkcs8 -topk8 -nocrypt -in private_key.pem -out private_key.pk8.pem"
            }
            check(pem.contains("BEGIN PRIVATE KEY")) { "the private key is not a valid PEM block" }

            val base64 = pem.replace(Regex("-----(BEGIN|END) PRIVATE KEY-----"), "").replace(Regex("\\s"), "")
            return try {
                val der = Base64.getDecoder().decode(base64)
                KeyFactory.getInstance("RSA").generatePrivate(PKCS8EncodedKeySpec(der)) as RSAPrivateKey
            } catch (e: IllegalArgumentException) {
                throw IllegalStateException("the private key is not an RSA key in PKCS#8: ${e.message}", e)
            } catch (e: GeneralSecurityException) {
                throw IllegalStateException("the private key is not an RSA key in PKCS#8: ${e.message}", e)
            } catch (e: ClassCastException) {
                throw IllegalStateException("the private key is not an RSA key in PKCS#8: ${e.message}", e)
            }
        }
    }
}
