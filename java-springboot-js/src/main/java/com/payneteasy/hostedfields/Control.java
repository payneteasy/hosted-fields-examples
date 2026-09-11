package com.payneteasy.hostedfields;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.Map;

/**
 * The checksum the gateway signs its callbacks with, kept apart from the routes so it can be
 * tested without a server.
 *
 * <p>https://doc.payneteasy.com/integration/API_commands/merchant_callback_parameters.html
 */
final class Control {

    private Control() {}

    /** {@code sha1(status + orderid + merchant_order + merchant_control)}, lowercase hex. */
    static String checksum(String status, String orderId, String merchantOrder, String merchantControl) {
        try {
            MessageDigest sha1 = MessageDigest.getInstance("SHA-1");
            byte[] digest =
                    sha1.digest((status + orderId + merchantOrder + merchantControl).getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException e) {
            // SHA-1 is one of the digests every JVM is required to have
            throw new IllegalStateException(e);
        }
    }

    /**
     * Whether a callback really came from the gateway. A missing parameter reads as "", so an
     * empty callback still has a well-defined checksum rather than a special case.
     *
     * <p>{@code MessageDigest.isEqual} rather than {@code equals}: it does not stop at the first
     * differing byte, and it answers false for a length mismatch instead of throwing, so a forged
     * short control is a 403 and not a 500.
     */
    static boolean valid(Map<String, String> form, String merchantControl) {
        String expected = checksum(
                form.getOrDefault("status", ""),
                form.getOrDefault("orderid", ""),
                form.getOrDefault("merchant_order", ""),
                merchantControl);
        return MessageDigest.isEqual(
                expected.getBytes(StandardCharsets.UTF_8),
                form.getOrDefault("control", "").getBytes(StandardCharsets.UTF_8));
    }
}
