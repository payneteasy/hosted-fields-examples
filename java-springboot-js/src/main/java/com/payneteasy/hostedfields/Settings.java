package com.payneteasy.hostedfields;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.interfaces.RSAPrivateKey;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Settings, all of them environment variables. See {@code .env.example}.
 *
 * <p>They are loaded and validated in {@code main}, before the servlet container starts, so the app
 * refuses to boot rather than serving a page that cannot take a payment — and so that {@code
 * ./mvnw verify} needs no credentials, because nothing here runs at class initialisation.
 *
 * @param listenAddr interface to listen on. The default is loopback: the example speaks plain HTTP
 *     and trusts X-Forwarded-For, both of which are only safe with a proxy in front. Set 0.0.0.0
 *     knowingly.
 * @param basePath URL prefix everything is mounted under
 * @param publicUrl origin the payer's browser sees, no path
 * @param sdkOrigin origin of {@code sdkUrl}, scheme and host only: the Content-Security-Policy has
 *     to name the host the SDK bundle and the card iframes come from, and nothing else
 * @param merchantControl shared secret the gateway signs its callbacks with. Not the RSA key.
 * @param privateKey signs the server calls, never leaves the server
 */
record Settings(
        String port,
        String listenAddr,
        String basePath,
        String publicUrl,
        String apiUrl,
        String sdkUrl,
        String sdkOrigin,
        String endpointId,
        String merchantLogin,
        String merchantControl,
        String orderAmount,
        String orderCurrency,
        RSAPrivateKey privateKey) {

    /**
     * A record prints every component, and one of these is the private key. Anything that logs a
     * Settings — a stack trace, a debug line — would otherwise put the key in the log.
     */
    @Override
    public String toString() {
        return "Settings[basePath=" + basePath + ", publicUrl=" + publicUrl + ", apiUrl=" + apiUrl + "]";
    }

    /** Where the payer lands after a 3DS challenge. Built from PUBLIC_URL, not from the listen
     *  address, which behind a proxy is not the same. */
    String redirectUrl() {
        return publicUrl + basePath + "/result/callback";
    }

    /** Reads the environment, the {@code .env} file beside it and the key, and validates the lot.
     *  Every failure is an IllegalStateException whose message names what is missing. */
    static Settings load(Path envFile) {
        Map<String, String> file = readEnvFile(envFile);

        String port = env(file, "PORT", "3006");
        String sdkUrl = env(file, "SDK_URL", "");

        Settings settings = new Settings(
                port,
                env(file, "LISTEN_ADDR", "127.0.0.1"),
                env(file, "BASE_PATH", "/hosted-fields-examples-java"),
                env(file, "PUBLIC_URL", "http://localhost:" + port),
                env(file, "API_URL", ""),
                sdkUrl,
                origin(sdkUrl),
                env(file, "ENDPOINT_ID", ""),
                env(file, "MERCHANT_LOGIN", ""),
                env(file, "MERCHANT_CONTROL", ""),
                env(file, "ORDER_AMOUNT", "1.00"),
                env(file, "ORDER_CURRENCY", "USD"),
                OAuth.parsePrivateKey(readPrivateKey(file)));

        // The five without a default. A stale gateway host baked in here would silently point a
        // real payment somewhere it does not belong, so there is nothing to fall back to.
        Map<String, String> required = new LinkedHashMap<>();
        required.put("API_URL", settings.apiUrl());
        required.put("SDK_URL", settings.sdkUrl());
        required.put("ENDPOINT_ID", settings.endpointId());
        required.put("MERCHANT_LOGIN", settings.merchantLogin());
        required.put("MERCHANT_CONTROL", settings.merchantControl());
        for (Map.Entry<String, String> setting : required.entrySet()) {
            if (setting.getValue().isEmpty()) {
                throw new IllegalStateException(setting.getKey() + " is not set, see .env.example");
            }
        }
        return settings;
    }

    /** The key comes from a file on a server, or inline for local runs. */
    private static String readPrivateKey(Map<String, String> file) {
        String path = env(file, "PRIVATE_KEY_PATH", "");
        if (!path.isEmpty()) {
            try {
                return Files.readString(Path.of(path), StandardCharsets.UTF_8);
            } catch (IOException e) {
                throw new IllegalStateException("cannot read PRIVATE_KEY_PATH " + path + ": " + e.getMessage(), e);
            }
        }
        String inline = env(file, "PRIVATE_KEY", "");
        if (!inline.isEmpty()) {
            return inline;
        }
        throw new IllegalStateException("set PRIVATE_KEY_PATH or PRIVATE_KEY, see .env.example");
    }

    /** One setting: the real environment first, then {@code .env}, then the fallback. An empty
     *  value counts as unset, so a copied .env.example fails with a message naming what is missing
     *  rather than half working. */
    private static String env(Map<String, String> file, String name, String fallback) {
        String value = System.getenv(name);
        if (value == null || value.isEmpty()) {
            value = file.get(name);
        }
        return value == null || value.isEmpty() ? fallback : value;
    }

    /**
     * Reads a KEY=value file, the way {@code node --env-file} does. A missing file is not an error.
     *
     * <p>Java cannot write to its own environment, so the values are returned and consulted
     * <em>after</em> it — which is the behaviour the other examples get by refusing to overwrite a
     * variable that is already set. A harness can drive the app without writing an .env, and a
     * stale .env never wins over what the process was started with.
     */
    private static Map<String, String> readEnvFile(Path path) {
        Map<String, String> values = new HashMap<>();
        if (!Files.isReadable(path)) {
            return values;
        }
        List<String> lines;
        try {
            lines = Files.readAllLines(path, StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        for (String raw : lines) {
            String line = raw.strip();
            if (line.isEmpty() || line.startsWith("#")) {
                continue;
            }
            // The first = separates, so a value may contain more of them
            int separator = line.indexOf('=');
            if (separator < 0) {
                continue;
            }
            String name = line.substring(0, separator).strip();
            String value = line.substring(separator + 1).strip();
            if (value.length() > 1
                    && ((value.startsWith("\"") && value.endsWith("\""))
                            || (value.startsWith("'") && value.endsWith("'")))) {
                value = value.substring(1, value.length() - 1);
            }
            values.put(name, value);
        }
        return values;
    }

    /** Scheme, host and port of a URL, or "" when it is not one. */
    private static String origin(String url) {
        try {
            URI parsed = URI.create(url);
            if (parsed.getScheme() == null || parsed.getHost() == null) {
                return "";
            }
            String port = parsed.getPort() < 0 ? "" : ":" + parsed.getPort();
            return parsed.getScheme() + "://" + parsed.getHost() + port;
        } catch (IllegalArgumentException e) {
            return "";
        }
    }
}
