package com.payneteasy.hostedfields

import kotlin.test.Test
import kotlin.test.assertEquals

/** The signature encoding, on the same vectors as every other example. */
class OAuthTest {
    @Test
    fun `encode is RFC 3986, not form encoding`() {
        // Each of these is somewhere a form encoder differs, and each one the gateway rejects
        assertEquals("%21%27%28%29%2A", OAuth.encode("!'()*"))
        assertEquals("John%20Smith", OAuth.encode("John Smith"))
        assertEquals("a%2Bb", OAuth.encode("a+b"))
        assertEquals("abcXYZ019-._~", OAuth.encode("abcXYZ019-._~"))
        // Per byte of the UTF-8 form, not per character
        assertEquals("%C3%A9", OAuth.encode("é"))
    }

    @Test
    fun `normalize sorts by key`() {
        val params =
            mapOf(
                "oauth_consumer_key" to "merchant",
                "amount" to "1.00",
                "client_orderid" to "hf-1",
            )
        assertEquals("amount=1.00&client_orderid=hf-1&oauth_consumer_key=merchant", OAuth.normalize(params))
    }

    @Test
    fun `the base string matches the other examples`() {
        val params =
            mapOf(
                "amount" to "1.00",
                "client_orderid" to "hf-1",
                "oauth_consumer_key" to "merchant",
            )
        assertEquals(
            "POST&https%3A%2F%2Fgateway.example%2Fpaynet%2Fapi%2Fv4%2Fsale%2F123" +
                "&amount%3D1.00%26client_orderid%3Dhf-1%26oauth_consumer_key%3Dmerchant",
            OAuth.baseString("POST", "https://gateway.example/paynet/api/v4/sale/123", params),
        )
    }
}
