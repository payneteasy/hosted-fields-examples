using System;
using Xunit;

namespace HostedFields.Tests;

// The gateway is not consistent about the JSON type of paynet-order-id — a sale reply answers with
// a number, other calls with a string — so the log line has to survive both. A typed model would
// report a perfectly good sale reply as "reply is not JSON".
public class PaynetTests
{
    [Theory]
    // A sale reply, with the order id as a number
    [InlineData(
        """{"type":"async-form-response","paynet-order-id":12345,"merchant-order-id":"hf-abc"}""",
        " order 12345")]
    // The same order id, as a string
    [InlineData("""{"paynet-order-id":"12345","merchant-order-id":"hf-abc"}""", " order 12345")]
    // A long order id keeps its digits, rather than turning into 1.2345678901e+10
    [InlineData("""{"paynet-order-id":12345678901}""", " order 12345678901")]
    // A decline carries the reason as well
    [InlineData(
        """{"paynet-order-id":12345,"error-message":"Declined by the issuer","error-code":3}""",
        " order 12345 Declined by the issuer")]
    // A message spread over lines is flattened
    [InlineData("""{"error-message":"Declined\n  by the issuer"}""", " Declined by the issuer")]
    // Nothing worth logging
    [InlineData("""{"type":"async-form-response"}""", "")]
    // A reply that really is not JSON says so
    [InlineData("type=async-form-response\npaynet-order-id=12345", " (reply is not JSON)")]
    // JSON, but not an object: still nothing this can read
    [InlineData("\"async-form-response\"", " (reply is not JSON)")]
    public void LogReasonSaysWhatHappenedAndNoMore(string body, string expected) =>
        Assert.Equal(expected, Paynet.LogReason(body));

    // The body itself must never reach the log: a status reply carries the card and the holder, and
    // the ticket reply carries the ticket.
    [Theory]
    [InlineData("JOHN SMITH")]
    [InlineData("4448")]
    [InlineData("secret-ticket")]
    public void LogReasonKeepsTheBodyOut(string secret)
    {
        const string Body = """
            {"paynet-order-id":12345,"card-printed-name":"JOHN SMITH","last-four-digits":"4448",
             "ephemeralTicket":"secret-ticket"}
            """;

        Assert.DoesNotContain(secret, Paynet.LogReason(Body), StringComparison.Ordinal);
    }
}
