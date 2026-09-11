using System;
using System.Collections.Generic;
using Xunit;

namespace HostedFields.Tests;

// The signature base string is where OAuth quietly breaks: every part has to be percent-encoded to
// RFC 3986, and a form encoder is not. A wrong byte here is a 401 from the gateway with nothing in
// the log to say why, so these are the vectors that pin it down.
public class OAuthTests
{
    [Theory]
    // The five characters a form encoder leaves alone and OAuth does not
    [InlineData("!'()*", "%21%27%28%29%2A")]
    // A space is %20, never +
    [InlineData("John Smith", "John%20Smith")]
    // + is a literal plus, and must not survive as one
    [InlineData("a+b", "a%2Bb")]
    // Unreserved characters are left exactly as they are
    [InlineData("abcXYZ019-._~", "abcXYZ019-._~")]
    // Non-ASCII is encoded per UTF-8 byte
    [InlineData("é", "%C3%A9")]
    public void EncodeIsRfc3986(string input, string expected) =>
        Assert.Equal(expected, OAuth.Encode(input));

    [Fact]
    public void NormalizeSortsByKey()
    {
        var parameters = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["oauth_consumer_key"] = "merchant",
            ["amount"] = "1.00",
            ["client_orderid"] = "hf-1",
        };

        Assert.Equal("amount=1.00&client_orderid=hf-1&oauth_consumer_key=merchant", OAuth.Normalize(parameters));
    }

    // The same vector as the Express example's oauth.test.js and the Go example's oauth_test.go,
    // so the signatures cannot drift.
    [Fact]
    public void BaseStringMatchesTheExpressExample()
    {
        var parameters = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["oauth_consumer_key"] = "merchant",
            ["amount"] = "1.00",
            ["client_orderid"] = "hf-1",
        };

        Assert.Equal(
            "POST&https%3A%2F%2Fgateway.example%2Fpaynet%2Fapi%2Fv4%2Fsale%2F123&"
                + "amount%3D1.00%26client_orderid%3Dhf-1%26oauth_consumer_key%3Dmerchant",
            OAuth.BaseString("POST", "https://gateway.example/paynet/api/v4/sale/123", parameters));
    }
}
