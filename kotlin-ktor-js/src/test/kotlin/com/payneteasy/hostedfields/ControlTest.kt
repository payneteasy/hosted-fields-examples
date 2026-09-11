package com.payneteasy.hostedfields

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * The 3DS callback checksum, on the same vectors as every other example.
 *
 * No credentials and no stubbed environment: [Control] is pure and [Settings] is built in `main`,
 * so there is nothing to stub.
 */
class ControlTest {
    private val merchantControl = "test-merchant-control"

    // sha1("approved" + "1234567" + "hf-abc" + "test-merchant-control")
    private val control = "652ace404c4dfe8bba069ecee594ec23a89340e1"

    private fun signedCallback() =
        mutableMapOf(
            "status" to "approved",
            "orderid" to "1234567",
            "merchant_order" to "hf-abc",
            "control" to control,
        )

    @Test
    fun `signs the documented fields`() {
        assertEquals(control, Control.checksum("approved", "1234567", "hf-abc", merchantControl))
    }

    @Test
    fun `accepts a signed callback`() {
        assertTrue(Control.valid(signedCallback(), merchantControl))
    }

    @Test
    fun `rejects an edited field`() {
        for (field in listOf("status", "orderid", "merchant_order")) {
            val tampered = signedCallback()
            tampered[field] = tampered.getValue(field) + "-edited"
            assertFalse(Control.valid(tampered, merchantControl), "$field is not covered by the checksum")
        }
    }

    @Test
    fun `rejects a wrong control of the right length`() {
        val tampered = signedCallback()
        tampered["control"] = "0".repeat(control.length)
        assertFalse(Control.valid(tampered, merchantControl))
    }

    @Test
    fun `rejects a control of the wrong length without throwing`() {
        // A hand-edited return URL has to be a 403, not an exception on the way to a 500
        for (wrong in listOf("", "short", control + "extra")) {
            val tampered = signedCallback()
            tampered["control"] = wrong
            assertFalse(Control.valid(tampered, merchantControl))
        }
    }

    @Test
    fun `an empty callback still has a checksum`() {
        // Which is what stops a bare /result with no control reaching the page
        assertFalse(Control.valid(emptyMap(), merchantControl))
        val empty = mapOf("control" to Control.checksum("", "", "", merchantControl))
        assertTrue(Control.valid(empty, merchantControl))
    }
}
