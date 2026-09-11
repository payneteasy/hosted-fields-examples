using System;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Text;

namespace HostedFields;

/// <summary>
/// The 3DS return callback: the checksum the gateway signs it with, and the fields that travel on.
/// <see href="https://doc.payneteasy.com/integration/API_commands/merchant_callback_parameters.html"/>
/// </summary>
/// <remarks>
/// This lives apart from Program.cs so it can be tested without starting a listener. Go keeps the
/// same function in main.go, Express in src/callback.js, PHP in control.php, Flask in control.py,
/// Sinatra in control.rb and axum in src/control.rs; all of them must agree.
/// </remarks>
public static class Control
{
    /// <summary>
    /// The parameters the gateway signs its callback with, in the order the page wants them back.
    /// </summary>
    public static readonly string[] SignedCallbackFields =
        ["status", "orderid", "merchant_order", "control"];

    /// <summary><c>sha1(status + orderid + merchant_order + MERCHANT_CONTROL)</c>, lowercase hex.</summary>
    public static string Checksum(string status, string orderId, string merchantOrder, string merchantControl) =>
        Convert.ToHexString(
            SHA1.HashData(Encoding.UTF8.GetBytes(status + orderId + merchantOrder + merchantControl)))
            .ToLowerInvariant();

    /// <summary>
    /// Whether a callback — or the query the payer carries on to /result — really came from the
    /// gateway. Absent parameters count as empty strings, so an empty callback still has a
    /// well-defined checksum rather than validating against a missing one.
    /// </summary>
    public static bool ValidCallback(IReadOnlyDictionary<string, string> parameters, string merchantControl)
    {
        string Field(string name) => parameters.TryGetValue(name, out string? value) ? value : "";

        string expected = Checksum(Field("status"), Field("orderid"), Field("merchant_order"), merchantControl);

        // Constant time, and false rather than an exception when the lengths differ — a wrong
        // length is already a wrong checksum.
        return CryptographicOperations.FixedTimeEquals(
            Encoding.UTF8.GetBytes(expected),
            Encoding.UTF8.GetBytes(Field("control")));
    }
}
