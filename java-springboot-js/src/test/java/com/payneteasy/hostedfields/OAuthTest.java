package com.payneteasy.hostedfields;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.LinkedHashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * The signature base string, on the same vectors as the other examples. Nothing here needs a key,
 * a network or a setting: the two pieces that fail silently are both pure functions.
 */
class OAuthTest {

    /** The whole reason for a hand-written encoder: URLEncoder writes a space as + and leaves
     *  ! ' ( ) * alone, and either one is a 401 from the gateway with no explanation. */
    @Test
    void encodeIsRfc3986() {
        assertEquals("%21%27%28%29%2A", OAuth.encode("!'()*"));
        assertEquals("John%20Smith", OAuth.encode("John Smith"));
        assertEquals("a%2Bb", OAuth.encode("a+b"));
        assertEquals("abcXYZ019-._~", OAuth.encode("abcXYZ019-._~"));
        assertEquals("%C3%A9", OAuth.encode("é"));
    }

    @Test
    void normalizeSortsByKey() {
        Map<String, String> params = new LinkedHashMap<>();
        params.put("oauth_consumer_key", "merchant");
        params.put("client_orderid", "hf-1");
        params.put("amount", "1.00");

        assertEquals("amount=1.00&client_orderid=hf-1&oauth_consumer_key=merchant", OAuth.normalize(params));
    }

    @Test
    void baseStringMatchesTheOtherExamples() {
        Map<String, String> params = new LinkedHashMap<>();
        params.put("amount", "1.00");
        params.put("client_orderid", "hf-1");
        params.put("oauth_consumer_key", "merchant");

        assertEquals(
                "POST&https%3A%2F%2Fgateway.example%2Fpaynet%2Fapi%2Fv4%2Fsale%2F123"
                        + "&amount%3D1.00%26client_orderid%3Dhf-1%26oauth_consumer_key%3Dmerchant",
                OAuth.baseString("POST", "https://gateway.example/paynet/api/v4/sale/123", params));
    }
}
