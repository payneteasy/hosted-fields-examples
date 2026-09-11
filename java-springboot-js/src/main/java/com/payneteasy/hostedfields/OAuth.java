package com.payneteasy.hostedfields;

// OAuth 1.0a RSA-SHA256 request signing.
// https://doc.payneteasy.com/integration/general_api_usage/request_authentication_methods/oauth.html

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.KeyFactory;
import java.security.SecureRandom;
import java.security.Signature;
import java.security.interfaces.RSAPrivateKey;
import java.security.spec.PKCS8EncodedKeySpec;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Map;
import java.util.TreeMap;
import java.util.stream.Collectors;

/** Signs the calls to the gateway. Everything it needs is in {@code java.security}. */
final class OAuth {

    private static final SecureRandom RANDOM = new SecureRandom();

    private final String consumerKey;
    private final RSAPrivateKey privateKey;

    OAuth(Settings settings) {
        this.consumerKey = settings.merchantLogin();
        this.privateKey = settings.privateKey();
    }

    /**
     * Builds the Authorization header for a signed API call. {@code params} are the
     * x-www-form-urlencoded parameters of the request, if any.
     */
    String authHeader(String method, String endpoint, Map<String, String> params) {
        byte[] nonce = new byte[16];
        RANDOM.nextBytes(nonce);

        Map<String, String> oauth = new TreeMap<>();
        oauth.put("oauth_consumer_key", consumerKey);
        oauth.put("oauth_nonce", HexFormat.of().formatHex(nonce));
        oauth.put("oauth_signature_method", "RSA-SHA256");
        oauth.put("oauth_timestamp", Long.toString(System.currentTimeMillis() / 1000));
        oauth.put("oauth_version", "1.0");

        Map<String, String> signed = new TreeMap<>(params);
        signed.putAll(oauth);
        oauth.put("oauth_signature", sign(baseString(method, endpoint, signed)));

        // Header values are not encoded by the transport, so encode them here
        return "OAuth "
                + oauth.entrySet().stream()
                        .map(pair -> pair.getKey() + "=\"" + encode(pair.getValue()) + "\"")
                        .collect(Collectors.joining(", "));
    }

    private String sign(String baseString) {
        try {
            Signature rsa = Signature.getInstance("SHA256withRSA");
            rsa.initSign(privateKey);
            rsa.update(baseString.getBytes(StandardCharsets.UTF_8));
            return Base64.getEncoder().encodeToString(rsa.sign());
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("cannot sign the request: " + e.getMessage(), e);
        }
    }

    /** The signature base string: METHOD&amp;url&amp;sorted-parameters, each part percent-encoded. */
    static String baseString(String method, String endpoint, Map<String, String> params) {
        return method.toUpperCase(java.util.Locale.ROOT) + "&" + encode(endpoint) + "&" + encode(normalize(params));
    }

    static String normalize(Map<String, String> params) {
        return new TreeMap<>(params)
                .entrySet().stream()
                        .map(pair -> encode(pair.getKey()) + "=" + encode(pair.getValue()))
                        .collect(Collectors.joining("&"));
    }

    /**
     * RFC 3986 percent encoding. Not {@code URLEncoder.encode}, which is form encoding: it writes a
     * space as {@code +} and leaves {@code * } alone, and the gateway then answers a bare 401 with
     * nothing in the reply to say why.
     */
    static String encode(String value) {
        final String unreserved = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~";

        StringBuilder out = new StringBuilder();
        // Per byte of the UTF-8 form, not per character: a non-ASCII character is several bytes
        // and each one is escaped on its own.
        for (byte b : value.getBytes(StandardCharsets.UTF_8)) {
            if (unreserved.indexOf(b) >= 0) {
                out.append((char) b);
            } else {
                out.append('%').append(HexFormat.of().withUpperCase().toHexDigits(b));
            }
        }
        return out.toString();
    }

    /**
     * Reads a PKCS#8 PEM, with real newlines or with escaped {@code \n}, so the key can also live
     * on a single line in an environment variable.
     *
     * <p>PKCS#8 only: {@code KeyFactory} reads nothing else, and a PKCS#1 key — the one whose
     * header says {@code BEGIN RSA PRIVATE KEY} — has to be converted first. The message below
     * says how.
     */
    static RSAPrivateKey parsePrivateKey(String text) {
        String pem = text.replace("\\n", "\n").strip();
        if (pem.contains("BEGIN RSA PRIVATE KEY")) {
            throw new IllegalStateException("the private key is PKCS#1 and the JDK reads PKCS#8 only, convert it with:"
                    + " openssl pkcs8 -topk8 -nocrypt -in private_key.pem -out private_key.pk8.pem");
        }
        if (!pem.contains("BEGIN PRIVATE KEY")) {
            throw new IllegalStateException("the private key is not a valid PEM block");
        }

        String base64 = pem.replaceAll("-----(BEGIN|END) PRIVATE KEY-----", "").replaceAll("\\s", "");
        try {
            byte[] der = Base64.getDecoder().decode(base64);
            return (RSAPrivateKey) KeyFactory.getInstance("RSA").generatePrivate(new PKCS8EncodedKeySpec(der));
        } catch (IllegalArgumentException | GeneralSecurityException | ClassCastException e) {
            throw new IllegalStateException("the private key is not an RSA key in PKCS#8: " + e.getMessage(), e);
        }
    }
}
