package com.payneteasy.hostedfields

import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.util.HexFormat

/**
 * The checksum the gateway signs its 3DS return with.
 *
 * It is checked twice over the same function: once on the POST the gateway makes to
 * `/result/callback`, and again on the query `GET /result` is reached with. The browser carries
 * the four values in between but cannot forge them, because it does not know MERCHANT_CONTROL.
 */
object Control {
    /** The four values the gateway signs, in the order it concatenates them. */
    val SIGNED_FIELDS = listOf("status", "orderid", "merchant_order", "control")

    /** `sha1(status + orderid + merchant_order + merchant_control)`, lowercase hex. */
    fun checksum(
        status: String,
        orderId: String,
        merchantOrder: String,
        merchantControl: String,
    ): String {
        val digest =
            MessageDigest
                .getInstance("SHA-1")
                .digest((status + orderId + merchantOrder + merchantControl).toByteArray(StandardCharsets.UTF_8))
        return HexFormat.of().formatHex(digest)
    }

    /**
     * Whether a callback or a result query carries the checksum it should.
     *
     * A missing field counts as empty, so an empty callback still has a well-defined checksum —
     * which is what stops a bare `/result?orderid=…` with no control from passing. The comparison
     * is constant-time and never throws on a control of the wrong length: that has to be a 403,
     * not an exception on the way to a 500.
     */
    fun valid(
        form: Map<String, String>,
        merchantControl: String,
    ): Boolean {
        val expected =
            checksum(
                form["status"].orEmpty(),
                form["orderid"].orEmpty(),
                form["merchant_order"].orEmpty(),
                merchantControl,
            )
        return MessageDigest.isEqual(
            expected.toByteArray(StandardCharsets.UTF_8),
            form["control"].orEmpty().toByteArray(StandardCharsets.UTF_8),
        )
    }
}
