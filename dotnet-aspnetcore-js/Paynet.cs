using System;
using System.Collections.Generic;
using System.Globalization;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;

// A decoded gateway reply. Keys are the documented kebab-case names; values stay as JsonElement
// because they are not all strings — a sale reply answers paynet-order-id as a number and
// error-code as a number, and the other calls answer the same order id as a string. A typed model
// would report a perfectly good reply as malformed. The alias is the analogue of Go's
// `type response map[string]any`.
using Response = System.Collections.Generic.Dictionary<string, System.Text.Json.JsonElement>;

namespace HostedFields;

/// <summary>Payer details collected by our own inputs, next to the card iframes.</summary>
public sealed class Customer
{
    public string FirstName { get; init; } = "";
    public string LastName { get; init; } = "";
    public string Email { get; init; } = "";

    /// <summary>
    /// The card holder name, composed by the page from the two above: the hosted fields token does
    /// not carry it, and with the token the platform leaves the holder empty unless it is sent
    /// here — which some acquirers do not survive.
    /// </summary>
    public string CardPrintedName { get; init; } = "";
}

/// <summary>What the page POSTs to /pay.</summary>
public sealed class PaymentRequest
{
    public string HostedFieldsToken { get; init; } = "";

    /// <summary>
    /// 3DS 2.0 browser data. Filtered against a fixed list before it goes anywhere near the Sale —
    /// see Program.cs.
    /// </summary>
    public Dictionary<string, string> Browser { get; init; } = [];

    public Customer Customer { get; init; } = new();
}

/// <summary>A gateway call that did not happen, or did not answer with a payment.</summary>
public sealed class GatewayException : Exception
{
    public GatewayException() { }

    public GatewayException(string message) : base(message) { }

    public GatewayException(string message, Exception inner) : base(message, inner) { }
}

/// <summary>
/// The three gateway calls the Hosted Fields flow needs.
/// <see href="https://doc.payneteasy.com/integration/api_use_cases/hosted_fields.html"/>
/// </summary>
public sealed class Paynet : IDisposable
{
    // The page writes its keys in camelCase, as JavaScript does; the properties above are C#.
    private static readonly JsonSerializerOptions FromTheBrowser = new() { PropertyNameCaseInsensitive = true };

    private readonly Settings _settings;
    private readonly ILogger<Paynet> _logger;

    // One client for the process: it is a singleton, so there is no socket to exhaust. The
    // timeout is explicit because a payment that hangs is worse than one that fails.
    private readonly HttpClient _gateway = new() { Timeout = TimeSpan.FromSeconds(30) };

    public Paynet(Settings settings, ILogger<Paynet> logger)
    {
        _settings = settings;
        _logger = logger;
    }

    public void Dispose() => _gateway.Dispose();

    /// <summary>Deserializes the /pay body the page sends.</summary>
    public static PaymentRequest? ReadPaymentRequest(string body) =>
        JsonSerializer.Deserialize<PaymentRequest>(body, FromTheBrowser);

    /// <summary>
    /// A single-use ticket the browser exchanges for a hosted fields token. It is valid for
    /// 15 minutes and safe to put on the page.
    /// </summary>
    public async Task<string> GetEphemeralTicketAsync()
    {
        Response decoded = await PostJsonAsync("/api/v4/tokenize/create-ephemeral-ticket/", []).ConfigureAwait(false);

        string ticket = decoded.TryGetValue("ephemeralTicket", out JsonElement value) && value.ValueKind == JsonValueKind.String
            ? (value.GetString() ?? "").Trim()
            : "";
        if (ticket.Length > 0)
        {
            return ticket;
        }

        // A rejected request comes back as 4xx with a JSON body carrying the reason. Only that one
        // field is quoted: this reason travels on into config.js, where the browser can read it,
        // and the rest of the reply is the gateway's business and not the payer's.
        string message = Text(decoded, "error-message");
        throw new GatewayException(
            message.Length > 0 ? "no ephemeralTicket: " + message : "no ephemeralTicket in the response");
    }

    /// <summary>
    /// Charges the card behind the hosted fields token. The token replaces credit_card_number,
    /// expire_month, expire_year and cvv2 — sending those is an error.
    /// </summary>
    public Task<Response> CreateSaleAsync(
        string hostedFieldsToken,
        string clientOrderId,
        string ipAddress,
        IReadOnlyDictionary<string, string> browser,
        Customer payer)
    {
        var parameters = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["client_orderid"] = clientOrderId,
            ["order_desc"] = "Hosted Fields example order",
            ["amount"] = _settings.OrderAmount,
            ["currency"] = _settings.OrderCurrency,
            ["hosted_fields_token"] = hostedFieldsToken,
            ["card_printed_name"] = payer.CardPrintedName,
            ["first_name"] = payer.FirstName,
            ["last_name"] = payer.LastName,
            ["address1"] = "100 Main st",
            ["city"] = "Seattle",
            ["zip_code"] = "98102",
            ["country"] = "US",
            ["state"] = "WA",
            ["phone"] = "+12063582043",
            ["email"] = payer.Email,
            ["ipaddress"] = ipAddress,
            ["redirect_url"] = _settings.RedirectUrl,
        };

        // 3DS 2.0 browser data, required by /api/v4/sale. It comes from the page, so a parameter
        // the server has already set is never taken from it: the /pay handler filters the body to
        // the documented keys and this loop refuses to overwrite, so neither guard is load-bearing
        // on its own.
        foreach ((string name, string value) in browser)
        {
            if (!parameters.ContainsKey(name))
            {
                parameters[name] = value;
            }
        }

        return PostJsonAsync("/api/v4/sale/", parameters);
    }

    /// <summary>Polled until the order reaches a final status.</summary>
    public Task<Response> GetStatusAsync(string orderId, string clientOrderId) =>
        PostJsonAsync("/api/v4/status/", new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["login"] = _settings.MerchantLogin,
            ["client_orderid"] = clientOrderId,
            ["orderid"] = orderId,
        });

    /// <summary>
    /// Sends a signed command and decodes the reply. A rejected request — a validation error or a
    /// decline — comes back as 4xx with a JSON body, so the body is decoded whatever the status:
    /// it carries the error-message for the page. Only a reply that is not JSON at all counts as a
    /// failure of the call itself.
    /// </summary>
    private async Task<Response> PostJsonAsync(string command, Dictionary<string, string> parameters)
    {
        (string body, int status) = await PostAsync(command, parameters).ConfigureAwait(false);

        Response? decoded;
        try
        {
            decoded = JsonSerializer.Deserialize<Response>(body);
        }
        catch (JsonException)
        {
            decoded = null;
        }

        // The body is not quoted: it reaches the page as {error}. The log line above has the detail.
        return decoded
            ?? throw new GatewayException(
                string.Create(CultureInfo.InvariantCulture, $"gateway request failed with {status}"));
    }

    private async Task<(string Body, int Status)> PostAsync(string command, Dictionary<string, string> parameters)
    {
        string endpoint = _settings.ApiUrl + command + _settings.EndpointId;

        using var request = new HttpRequestMessage(HttpMethod.Post, endpoint)
        {
            // The Sale body really is form encoded. The signature is not — see OAuth.Encode.
            Content = new FormUrlEncodedContent(parameters),
        };
        // Ask for JSON instead of the default x-www-form-urlencoded reply.
        // https://doc.payneteasy.com/integration/openapi.html
        request.Headers.Add("Accept", "application/vnd.pay+json");
        // Without validation: HttpClient parses a known header, and the OAuth scheme's comma-separated
        // quoted parameters are not what its Authorization parser expects. The value is built by
        // OAuth.Header and needs no help.
        request.Headers.TryAddWithoutValidation(
            "Authorization",
            OAuth.Header("POST", endpoint, parameters, _settings.MerchantLogin, _settings.PrivateKey));

        using HttpResponseMessage result = await _gateway.SendAsync(request).ConfigureAwait(false);
        string body = await result.Content.ReadAsStringAsync().ConfigureAwait(false);

        _logger.LogInformation(
            "[paynet] POST {Endpoint} -> {Status}{Reason}", endpoint, (int)result.StatusCode, LogReason(body));
        return (body, (int)result.StatusCode);
    }

    /// <summary>
    /// What goes in the log beside the status code. Not the body: a status reply carries the card's
    /// last four digits and the holder's name, and the ticket reply carries the ticket. The gateway
    /// puts everything a log needs to be useful into these two fields anyway.
    /// </summary>
    public static string LogReason(string body)
    {
        JsonDocument document;
        try
        {
            document = JsonDocument.Parse(body);
        }
        catch (JsonException)
        {
            return " (reply is not JSON)";
        }

        using (document)
        {
            if (document.RootElement.ValueKind != JsonValueKind.Object)
            {
                return " (reply is not JSON)";
            }

            var decoded = new Response(StringComparer.Ordinal);
            foreach (JsonProperty property in document.RootElement.EnumerateObject())
            {
                decoded[property.Name] = property.Value;
            }

            string reason = "";
            string id = Text(decoded, "paynet-order-id");
            if (id.Length > 0)
            {
                reason += " order " + id;
            }
            string message = Text(decoded, "error-message");
            if (message.Length > 0)
            {
                reason += " " + message;
            }
            return reason;
        }
    }

    /// <summary>
    /// One value of a decoded reply as text, whatever JSON type it arrived as, flattened onto one
    /// line. GetRawText rather than a number conversion, so a long order id keeps its digits
    /// instead of turning into 1.2345678901e+10.
    /// </summary>
    public static string Text(IReadOnlyDictionary<string, JsonElement> decoded, string name)
    {
        if (!decoded.TryGetValue(name, out JsonElement value))
        {
            return "";
        }

        string text = value.ValueKind switch
        {
            JsonValueKind.String => value.GetString() ?? "",
            JsonValueKind.Null or JsonValueKind.Undefined => "",
            _ => value.GetRawText(),
        };
        return string.Join(' ', text.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
    }
}
