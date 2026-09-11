package com.payneteasy.hostedfields

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse

/** What reaches the log about a gateway reply, and what must not. */
class PaynetTest {
    @Test
    fun `logs the order id and the reason, whatever their JSON type`() {
        assertEquals(" order 12345", Paynet.logReason("""{"paynet-order-id":12345}"""))
        assertEquals(" order 12345", Paynet.logReason("""{"paynet-order-id":"12345"}"""))
        // Digits, not 1.2345678901e+10: an order id is not a float
        assertEquals(" order 12345678901", Paynet.logReason("""{"paynet-order-id":12345678901}"""))
        assertEquals(
            " order 12345 Declined by the issuer",
            Paynet.logReason("""{"paynet-order-id":12345,"error-message":"Declined by the issuer"}"""),
        )
        // A log line is one line
        assertEquals(
            " Declined by the issuer",
            Paynet.logReason("""{"error-message":"Declined\n  by the issuer"}"""),
        )
        assertEquals("", Paynet.logReason("""{"status":"approved"}"""))
        assertEquals(" (reply is not JSON)", Paynet.logReason("<html>an error page</html>"))
    }

    @Test
    fun `keeps the body out of the log`() {
        val reply =
            """
            {"paynet-order-id":12345,"status":"approved","card-printed-name":"JOHN SMITH",
             "last-four-digits":"4448","ephemeralTicket":"secret-ticket"}
            """.trimIndent()
        val logged = Paynet.logReason(reply)
        for (secret in listOf("JOHN SMITH", "4448", "secret-ticket")) {
            assertFalse(logged.contains(secret), "$secret reached the log")
        }
        assertEquals(" order 12345", logged)
    }
}
