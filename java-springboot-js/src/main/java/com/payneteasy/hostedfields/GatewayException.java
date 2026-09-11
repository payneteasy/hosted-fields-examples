package com.payneteasy.hostedfields;

/**
 * A call to the gateway that did not produce an answer: a transport failure, or a reply that is not
 * JSON at all.
 *
 * <p>Checked on purpose. A decline is <em>not</em> one of these — it arrives as a perfectly good
 * JSON reply carrying {@code error-message}, and the page shows it — so every call site has to
 * decide what to do about a real failure, which in this app is one 502 with a message.
 */
final class GatewayException extends Exception {

    private static final long serialVersionUID = 1L;

    GatewayException(String message) {
        super(message);
    }

    GatewayException(String message, Throwable cause) {
        super(message, cause);
    }
}
