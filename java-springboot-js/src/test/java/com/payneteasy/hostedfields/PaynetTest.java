package com.payneteasy.hostedfields;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

import org.junit.jupiter.api.Test;

/** The log line: what a gateway reply is allowed to put in a log, and what it is not. */
class PaynetTest {

    @Test
    void namesTheOrderWhateverTypeItArrivedAs() {
        assertEquals(" order 12345", Paynet.logReason("{\"paynet-order-id\":12345}"));
        assertEquals(" order 12345", Paynet.logReason("{\"paynet-order-id\":\"12345\"}"));
    }

    /** A long id has to keep its digits rather than turn into exponent form. */
    @Test
    void keepsALongOrderIdIntact() {
        assertEquals(" order 12345678901", Paynet.logReason("{\"paynet-order-id\":12345678901}"));
    }

    @Test
    void namesTheReasonForADecline() {
        assertEquals(
                " order 12345 Declined by the issuer",
                Paynet.logReason("{\"paynet-order-id\":12345,\"error-message\":\"Declined by the issuer\"}"));
    }

    @Test
    void flattensAMultiLineMessage() {
        assertEquals(" Declined by the issuer", Paynet.logReason("{\"error-message\":\"Declined\\n  by the issuer\"}"));
    }

    @Test
    void saysNothingWhenThereIsNothingToSay() {
        assertEquals("", Paynet.logReason("{\"status\":\"approved\"}"));
        assertEquals(" (reply is not JSON)", Paynet.logReason("<html>Gateway timeout</html>"));
    }

    /** A status reply carries the card's last four digits and the holder's name, and the ticket
     *  reply carries the ticket. None of it belongs in a log. */
    @Test
    void keepsTheBodyOut() {
        String reply = "{\"paynet-order-id\":12345,\"card-printed-name\":\"JOHN SMITH\","
                + "\"last-four-digits\":\"4448\",\"ephemeralTicket\":\"secret-ticket\"}";
        String logged = Paynet.logReason(reply);

        assertFalse(logged.contains("JOHN SMITH"));
        assertFalse(logged.contains("4448"));
        assertFalse(logged.contains("secret-ticket"));
    }
}
