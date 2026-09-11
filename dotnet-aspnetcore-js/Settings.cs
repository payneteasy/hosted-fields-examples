using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;

namespace HostedFields;

/// <summary>
/// Settings, all of them environment variables. See .env.example.
/// </summary>
/// <remarks>
/// Everything here is read and validated once, in <c>Main</c>, before the listener is opened —
/// never lazily out of a static. A missing credential has to stop the process rather than surface
/// later as a payment page that cannot take a payment, and <c>dotnet build</c> and
/// <c>dotnet test</c> have to work with an empty environment. The Go, axum and Spring Boot
/// examples all place the check in the same spot, for the same two reasons.
/// </remarks>
public sealed class Settings
{
    public required string Port { get; init; }

    /// <summary>
    /// Interface to listen on. The default is loopback: the example speaks plain HTTP and trusts
    /// X-Forwarded-For, both of which are only safe with a proxy in front. Set 0.0.0.0 knowingly.
    /// </summary>
    public required string ListenAddr { get; init; }

    /// <summary>URL prefix everything is mounted under.</summary>
    public required string BasePath { get; init; }

    /// <summary>Origin the payer's browser sees, no path.</summary>
    public required string PublicUrl { get; init; }

    public required string ApiUrl { get; init; }
    public required string SdkUrl { get; init; }

    /// <summary>
    /// Origin of <see cref="SdkUrl"/>, scheme and host only: the Content-Security-Policy has to
    /// name the host the SDK bundle and the card iframes come from, and nothing else.
    /// </summary>
    public required string SdkOrigin { get; init; }

    public required string EndpointId { get; init; }
    public required string MerchantLogin { get; init; }

    /// <summary>Shared secret the gateway signs its callbacks with. Not the RSA key.</summary>
    public required string MerchantControl { get; init; }

    public required string OrderAmount { get; init; }
    public required string OrderCurrency { get; init; }

    /// <summary>Signs the server calls, and never leaves the server.</summary>
    public required RSA PrivateKey { get; init; }

    /// <summary>
    /// Where the payer lands after a 3DS challenge. Built from PUBLIC_URL, not from the listen
    /// address, which behind a proxy is not the same.
    /// </summary>
    public string RedirectUrl => PublicUrl + BasePath + "/result/callback";

    /// <summary>The URL the app answers on, for the line it logs at startup.</summary>
    public string LocalUrl => $"http://{ListenAddr}:{Port}{BasePath}/";

    public static Settings Load(string envFile)
    {
        LoadEnvFile(envFile);

        string port = Env("PORT", "3008");

        // No default for these five: the gateway host and the credentials are per-installation,
        // and a stale one baked in here would silently point a real payment somewhere it does not
        // belong.
        string apiUrl = Env("API_URL", "");
        string sdkUrl = Env("SDK_URL", "");
        string endpointId = Env("ENDPOINT_ID", "");
        string merchantLogin = Env("MERCHANT_LOGIN", "");
        string merchantControl = Env("MERCHANT_CONTROL", "");

        // An array rather than a dictionary, so the first thing missing is always reported first
        var required = new[]
        {
            ("API_URL", apiUrl),
            ("SDK_URL", sdkUrl),
            ("ENDPOINT_ID", endpointId),
            ("MERCHANT_LOGIN", merchantLogin),
            ("MERCHANT_CONTROL", merchantControl),
        };
        foreach ((string name, string value) in required)
        {
            if (value.Length == 0)
            {
                throw new InvalidOperationException($"{name} is not set, see .env.example");
            }
        }

        return new Settings
        {
            Port = port,
            ListenAddr = Env("LISTEN_ADDR", "127.0.0.1"),
            BasePath = Env("BASE_PATH", "/hosted-fields-examples-dotnet"),
            PublicUrl = Env("PUBLIC_URL", "http://localhost:" + port),
            ApiUrl = apiUrl,
            SdkUrl = sdkUrl,
            SdkOrigin = OriginOf(sdkUrl),
            EndpointId = endpointId,
            MerchantLogin = merchantLogin,
            MerchantControl = merchantControl,
            OrderAmount = Env("ORDER_AMOUNT", "1.00"),
            OrderCurrency = Env("ORDER_CURRENCY", "USD"),
            PrivateKey = ReadPrivateKey(),
        };
    }

    /// <summary>
    /// Scheme and host of a URL, or the empty string when it is not one the browser could fetch.
    /// An unusable SDK_URL leaves the policy naming only 'self', which fails loudly in the page
    /// rather than quietly widening it.
    /// </summary>
    private static string OriginOf(string url) =>
        Uri.TryCreate(url, UriKind.Absolute, out Uri? parsed) && parsed.Authority.Length > 0
            ? parsed.Scheme + "://" + parsed.Authority
            : "";

    /// <summary>
    /// The key comes from a file on a server, or inline for local runs. Both forms accept a PKCS#8
    /// or a PKCS#1 PEM, and escaped \n as well as real newlines, so the key can live on a single
    /// line in an environment variable.
    /// </summary>
    private static RSA ReadPrivateKey()
    {
        string path = Env("PRIVATE_KEY_PATH", "");
        string pem = path.Length > 0 ? File.ReadAllText(path) : Env("PRIVATE_KEY", "");
        if (pem.Length == 0)
        {
            throw new InvalidOperationException("set PRIVATE_KEY_PATH or PRIVATE_KEY, see .env.example");
        }

        var key = RSA.Create();
        try
        {
            key.ImportFromPem(pem.Replace("\\n", "\n", StringComparison.Ordinal));
        }
        catch (Exception error) when (error is ArgumentException or CryptographicException)
        {
            key.Dispose();
            throw new InvalidOperationException("the private key is not a valid PEM block", error);
        }
        return key;
    }

    /// <summary>
    /// An environment variable, treating an empty value as unset — otherwise a variable left blank
    /// in a deployment's environment file would beat the default instead of falling back to it.
    /// </summary>
    private static string Env(string name, string fallback)
    {
        string? value = Environment.GetEnvironmentVariable(name);
        return string.IsNullOrEmpty(value) ? fallback : value;
    }

    /// <summary>
    /// Reads a KEY=value file into the environment, the way <c>node --env-file</c> does. Already
    /// set variables win, so the shell — and the e2e suite, which passes every setting as a real
    /// environment variable — can override it. A file that is not there is not an error: on a
    /// server the settings come from systemd's EnvironmentFile and there is no .env at all.
    /// </summary>
    private static void LoadEnvFile(string path)
    {
        if (!File.Exists(path))
        {
            return;
        }

        foreach (string raw in File.ReadLines(path))
        {
            string line = raw.Trim();
            if (line.Length == 0 || line.StartsWith('#'))
            {
                continue;
            }

            int split = line.IndexOf('=', StringComparison.Ordinal);
            if (split < 0)
            {
                continue;
            }

            string name = line[..split].Trim();
            string value = line[(split + 1)..].Trim().Trim('"', '\'');
            if (Environment.GetEnvironmentVariable(name) is null)
            {
                Environment.SetEnvironmentVariable(name, value);
            }
        }
    }
}
