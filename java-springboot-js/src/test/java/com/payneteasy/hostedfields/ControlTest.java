package com.payneteasy.hostedfields;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.HashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * The 3DS callback checksum, on the vectors every other example uses. They are written out rather
 * than recomputed, so a change of algorithm here cannot quietly agree with itself.
 */
class ControlTest {

    private static final String MERCHANT_CONTROL = "test-merchant-control";

    /** sha1("approved" + "1234567" + "hf-abc" + "test-merchant-control") */
    private static final String CONTROL = "652ace404c4dfe8bba069ecee594ec23a89340e1";

    private static Map<String, String> callback() {
        Map<String, String> form = new HashMap<>();
        form.put("status", "approved");
        form.put("orderid", "1234567");
        form.put("merchant_order", "hf-abc");
        form.put("control", CONTROL);
        return form;
    }

    @Test
    void signsTheDocumentedFields() {
        assertEquals(CONTROL, Control.checksum("approved", "1234567", "hf-abc", MERCHANT_CONTROL));
    }

    @Test
    void acceptsASignedCallback() {
        assertTrue(Control.valid(callback(), MERCHANT_CONTROL));
    }

    @Test
    void rejectsAnEditedField() {
        for (String name : new String[] {"status", "orderid", "merchant_order"}) {
            Map<String, String> form = callback();
            form.put(name, form.get(name) + "x");
            assertFalse(Control.valid(form, MERCHANT_CONTROL), "an edited " + name + " must not verify");
        }
    }

    @Test
    void rejectsAWrongControlOfTheRightLength() {
        Map<String, String> form = callback();
        form.put("control", "0".repeat(CONTROL.length()));
        assertFalse(Control.valid(form, MERCHANT_CONTROL));
    }

    /** A forged control of the wrong length has to be a 403, not an exception on the way to a 500. */
    @Test
    void rejectsAControlOfTheWrongLength() {
        for (String forged : new String[] {"", "short", CONTROL + "extra"}) {
            Map<String, String> form = callback();
            form.put("control", forged);
            assertFalse(Control.valid(form, MERCHANT_CONTROL));
        }
    }

    /** A callback with nothing in it still has a well-defined checksum, and no control at all
     *  never verifies. */
    @Test
    void emptyCallbackStillHasAChecksum() {
        assertFalse(Control.valid(Map.of(), MERCHANT_CONTROL));

        // sha1("" + "" + "" + "test-merchant-control")
        assertEquals("1a66987ac24e927ff2979f83a41cb818936a9e62", Control.checksum("", "", "", MERCHANT_CONTROL));
        assertTrue(Control.valid(Map.of("control", "1a66987ac24e927ff2979f83a41cb818936a9e62"), MERCHANT_CONTROL));
    }
}
