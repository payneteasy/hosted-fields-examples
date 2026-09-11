using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Security.Cryptography;
using System.Text;

namespace HostedFields;

/// <summary>
/// OAuth 1.0a RSA-SHA256 request signing.
/// <see href="https://doc.payneteasy.com/integration/general_api_usage/request_authentication_methods/oauth.html"/>
/// </summary>
public static class OAuth
{
    /// <summary>
    /// The Authorization header for a signed API call. <paramref name="parameters"/> are the
    /// x-www-form-urlencoded parameters of the request, if any — the ephemeral ticket call sends
    /// none, and then only the oauth_* values are signed.
    /// </summary>
    public static string Header(
        string method,
        string endpoint,
        IReadOnlyDictionary<string, string> parameters,
        string consumerKey,
        RSA privateKey)
    {
        var oauth = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["oauth_consumer_key"] = consumerKey,
            ["oauth_nonce"] = Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant(),
            ["oauth_signature_method"] = "RSA-SHA256",
            ["oauth_timestamp"] = DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString(CultureInfo.InvariantCulture),
            ["oauth_version"] = "1.0",
        };

        var signed = new Dictionary<string, string>(parameters, StringComparer.Ordinal);
        foreach ((string name, string value) in oauth)
        {
            signed[name] = value;
        }

        byte[] signature = privateKey.SignData(
            Encoding.UTF8.GetBytes(BaseString(method, endpoint, signed)),
            HashAlgorithmName.SHA256,
            RSASignaturePadding.Pkcs1);
        oauth["oauth_signature"] = Convert.ToBase64String(signature);

        // Header values are not encoded by the transport, so they are encoded here
        return "OAuth " + string.Join(
            ", ",
            oauth.OrderBy(pair => pair.Key, StringComparer.Ordinal)
                 .Select(pair => $"{pair.Key}=\"{Encode(pair.Value)}\""));
    }

    /// <summary>
    /// The signature base string: METHOD&amp;url&amp;sorted-parameters, each part percent-encoded.
    /// </summary>
    public static string BaseString(string method, string endpoint, IReadOnlyDictionary<string, string> signed) =>
        method.ToUpperInvariant() + "&" + Encode(endpoint) + "&" + Encode(Normalize(signed));

    /// <summary>The signed parameters as <c>key=value</c> pairs, sorted by key and encoded.</summary>
    public static string Normalize(IReadOnlyDictionary<string, string> parameters) =>
        string.Join(
            "&",
            parameters.OrderBy(pair => pair.Key, StringComparer.Ordinal)
                      .Select(pair => Encode(pair.Key) + "=" + Encode(pair.Value)));

    /// <summary>
    /// RFC 3986 percent encoding, written out rather than taken from the framework.
    /// </summary>
    /// <remarks>
    /// This is not a form encoder and must never be replaced by one: form encoding writes a space
    /// as <c>+</c> and leaves <c>!'()*</c> alone, and either produces a signature the gateway
    /// rejects with a 401 that says nothing about why. The Sale <em>body</em> really is form
    /// encoded — that is what <see cref="Paynet"/>'s FormUrlEncodedContent is for — and the two
    /// must not be swapped.
    /// </remarks>
    public static string Encode(string value)
    {
        const string Unreserved = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~";

        var encoded = new StringBuilder(value.Length);
        foreach (byte b in Encoding.UTF8.GetBytes(value))
        {
            if (Unreserved.IndexOf((char)b, StringComparison.Ordinal) >= 0)
            {
                encoded.Append((char)b);
            }
            else
            {
                encoded.Append(CultureInfo.InvariantCulture, $"%{b:X2}");
            }
        }
        return encoded.ToString();
    }
}
