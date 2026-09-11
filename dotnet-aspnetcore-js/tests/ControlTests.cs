using System;
using System.Collections.Generic;
using Xunit;

namespace HostedFields.Tests;

// The 3DS return is only as good as this checksum: it is what separates a payer coming back from
// the bank from somebody typing an order id into the address bar. The vectors below were computed
// outside this code, and are the same ones the Go and Express examples use, so none can drift alone.
public class ControlTests
{
    private const string MerchantControl = "test-merchant-control";

    /// <summary>sha1("approved" + "1234567" + "hf-abc" + "test-merchant-control")</summary>
    private const string ControlSum = "652ace404c4dfe8bba069ecee594ec23a89340e1";

    private static Dictionary<string, string> SignedCallback() =>
        new(StringComparer.Ordinal)
        {
            ["status"] = "approved",
            ["orderid"] = "1234567",
            ["merchant_order"] = "hf-abc",
            ["control"] = ControlSum,
        };

    [Fact]
    public void TheChecksumIsLowercaseHexOfTheConcatenation() =>
        Assert.Equal(ControlSum, Control.Checksum("approved", "1234567", "hf-abc", MerchantControl));

    [Fact]
    public void ASignedCallbackValidates() =>
        Assert.True(Control.ValidCallback(SignedCallback(), MerchantControl));

    [Theory]
    [InlineData("status")]
    [InlineData("orderid")]
    [InlineData("merchant_order")]
    public void EverySignedFieldIsCovered(string field)
    {
        Dictionary<string, string> edited = SignedCallback();
        edited[field] = "edited";

        Assert.False(Control.ValidCallback(edited, MerchantControl), $"{field} is not covered by the checksum");
    }

    [Theory]
    // A wrong control of the right length, which is what a guess looks like
    [InlineData("652ace404c4dfe8bba069ecee594ec23a89340e0")]
    // A control of the wrong length must be rejected rather than throw
    [InlineData("")]
    [InlineData("short")]
    [InlineData(ControlSum + "extra")]
    public void AWrongControlIsRejected(string control)
    {
        Dictionary<string, string> odd = SignedCallback();
        odd["control"] = control;

        Assert.False(Control.ValidCallback(odd, MerchantControl), $"control \"{control}\" was accepted");
    }

    [Fact]
    public void AnEmptyCallbackStillHasAChecksum()
    {
        // An empty callback is not the empty string, so a bare /result must not pass on a missing
        // control.
        Assert.False(
            Control.ValidCallback(new Dictionary<string, string>(StringComparer.Ordinal), MerchantControl));

        // sha1("" + "" + "" + "test-merchant-control")
        var signed = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["control"] = "1a66987ac24e927ff2979f83a41cb818936a9e62",
        };
        Assert.True(Control.ValidCallback(signed, MerchantControl));
    }
}
