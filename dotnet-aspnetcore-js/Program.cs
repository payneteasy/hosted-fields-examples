using System;
using System.Collections.Generic;
using System.IO;
using System.Net.Http;
using System.Reflection;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using HostedFields;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Primitives;

// Settings are read and validated here, before the listener is opened: a missing credential has to
// stop the process rather than surface later as a payment page that cannot take a payment. Nothing
// is read lazily out of a static, so `dotnet build` and `dotnet test` need no credentials at all.
Settings settings;
try
{
    settings = Settings.Load(".env");
}
catch (Exception error)
    when (error is InvalidOperationException or IOException or UnauthorizedAccessException or CryptographicException)
{
    Console.Error.WriteLine(error.Message);
    return 1;
}

var builder = WebApplication.CreateBuilder(new WebApplicationOptions
{
    Args = args,
    // Pinned rather than taken from ASPNETCORE_ENVIRONMENT. In Development the framework inserts
    // the developer exception page: stack traces behind a payment page, and an injected inline
    // script that the Content-Security-Policy below has no 'unsafe-inline' for.
    EnvironmentName = Environments.Production,
});
builder.WebHost.UseUrls($"http://{settings.ListenAddr}:{settings.Port}");

var app = builder.Build();
using var paynet = new Paynet(settings, app.Services.GetRequiredService<ILogger<Paynet>>());
ILogger log = app.Logger;

string basePath = settings.BasePath;

// The stylesheet and the client scripts, by name and with the content type each is served as.
// An allowlist rather than a static file middleware: UseStaticFiles would serve whatever is in a
// directory, at the root rather than under BASE_PATH, with caching headers of its own. The Spring
// Boot example turns the same thing off with spring.web.resources.add-mappings, and Sinatra with
// `set :static, false`.
var publicFiles = new Dictionary<string, string>(StringComparer.Ordinal)
{
    ["styles.css"] = "text/css; charset=utf-8",
    ["checkout.js"] = "text/javascript; charset=utf-8",
    ["status.js"] = "text/javascript; charset=utf-8",
    ["result.js"] = "text/javascript; charset=utf-8",
};

// views/ and public/ are compiled into the assembly — see HostedFields.csproj — so the published
// app is one artefact with no files beside it. Read once here rather than per request.
Assembly assembly = Assembly.GetExecutingAssembly();

// ASP.NET Core's endpoint matcher ignores a trailing slash, so `{prefix}` and `{prefix}/` would
// reach the same endpoint and the views' relative asset URLs ("styles.css", "config.js") would
// resolve one path segment too high. The redirect has to happen before the endpoint runs, which is
// what this middleware is: Go's mux, Tomcat and nginx all send the same 301 by themselves.
app.Use(async (context, next) =>
{
    if (string.Equals(context.Request.Path.Value, basePath, StringComparison.Ordinal))
    {
        context.Response.Redirect(basePath + "/" + context.Request.QueryString, permanent: true);
        return;
    }
    await next(context);
});

// Every route lives under BASE_PATH, so several examples fit behind one nginx.
// The two pages are static files: the only thing this server generates is window.CONFIG, and it
// hands that over as a script of its own. That is what lets views/ be identical whatever language
// the example is written in.
//
// The payment page is registered at the bare prefix and reached at the trailing-slash form: the
// matcher ignores a trailing slash on the request path, and the middleware above has already sent
// anyone who asked for the bare form to `{prefix}/`.
app.MapGet(basePath, Checkout);
app.MapGet(basePath + "/config.js", ConfigJs);
app.MapGet(basePath + "/result-config.js", ResultConfigJs);
app.MapPost(basePath + "/pay", Pay);
app.MapGet(basePath + "/status", Status);
// The gateway returns the payer from a 3DS challenge with a POST, not a GET, so the callback and
// the page it sends them to are separate routes.
app.MapMethods(basePath + "/result/callback", ["GET", "POST"], ResultCallback);
app.MapGet(basePath + "/result", Result);
// Stylesheet and client scripts. A literal segment beats a parameter in ASP.NET Core's route
// matching, so the routes above are not shadowed by this one.
app.MapGet(basePath + "/{file}", PublicFile);

log.LogInformation("listening on {Url}", settings.LocalUrl);
app.Run();

Task Checkout(HttpContext context) => ServeView(context, "checkout.html");

// Step 1. A fresh single-use ticket for every page load, handed to the page as a script.
async Task ConfigJs(HttpContext context)
{
    var config = new Dictionary<string, string>(StringComparer.Ordinal)
    {
        ["basePath"] = settings.BasePath,
        ["sdkUrl"] = settings.SdkUrl,
        ["endpointId"] = settings.EndpointId,
        // The page shows what the server will actually charge
        ["amount"] = settings.OrderAmount,
        ["currency"] = settings.OrderCurrency,
    };

    try
    {
        config["ephemeralTicket"] = await paynet.GetEphemeralTicketAsync();
    }
    catch (Exception error) when (error is GatewayException or HttpRequestException or TaskCanceledException)
    {
        // This has to stay valid JavaScript whatever happened upstream, or the page cannot even
        // tell the payer that it did. checkout.js reads the absent ticket as terminal.
        log.LogError("[error] {Message}", error.Message);
        config["error"] = error.Message;
    }

    await WriteConfigJs(context, config);
}

// The 3DS return page needs no ticket: there is no card on it to tokenize.
Task ResultConfigJs(HttpContext context) =>
    WriteConfigJs(context, new Dictionary<string, string>(StringComparer.Ordinal)
    {
        ["basePath"] = settings.BasePath,
        ["amount"] = settings.OrderAmount,
        ["currency"] = settings.OrderCurrency,
    });

// Step 3. The browser has exchanged the card for a token; start the payment.
async Task Pay(HttpContext context)
{
    PaymentRequest? payment;
    try
    {
        using var body = new StreamReader(context.Request.Body);
        payment = Paynet.ReadPaymentRequest(await body.ReadToEndAsync());
    }
    catch (JsonException)
    {
        payment = null;
    }
    if (payment is null)
    {
        await WriteError(context, StatusCodes.Status400BadRequest, "malformed request body");
        return;
    }
    if (payment.HostedFieldsToken.Length == 0)
    {
        await WriteError(context, StatusCodes.Status400BadRequest, "hostedFieldsToken is required");
        return;
    }

    // The merchant's own identifier for the order. It is random rather than sequential or
    // clock-based: the page hands it back on every /status poll, so an id that can be guessed
    // would make somebody else's order readable — and two payers in the same millisecond would
    // have collided.
    string clientOrderId = "hf-" + Hex(RandomNumberGenerator.GetBytes(16));

    try
    {
        Dictionary<string, JsonElement> sale = await paynet.CreateSaleAsync(
            payment.HostedFieldsToken,
            clientOrderId,
            ClientIp(context),
            BrowserParams(payment.Browser, context.Request),
            payment.Customer);

        JsonObject reply = JsonSerializer.SerializeToNode(sale)!.AsObject();
        reply["clientOrderId"] = clientOrderId;
        await WriteJson(context, StatusCodes.Status200OK, reply);
    }
    catch (Exception error) when (error is GatewayException or HttpRequestException or TaskCanceledException)
    {
        await Fail(context, error);
    }
}

// Step 4. The page polls this until the order reaches a final status.
async Task Status(HttpContext context)
{
    string orderId = context.Request.Query["orderId"].ToString();
    string clientOrderId = context.Request.Query["clientOrderId"].ToString();
    if (orderId.Length == 0 || clientOrderId.Length == 0)
    {
        await WriteError(context, StatusCodes.Status400BadRequest, "orderId and clientOrderId are required");
        return;
    }

    try
    {
        Dictionary<string, JsonElement> status = await paynet.GetStatusAsync(orderId, clientOrderId);
        context.Response.Headers.CacheControl = "no-store";
        await WriteJson(context, StatusCodes.Status200OK, status);
    }
    catch (Exception error) when (error is GatewayException or HttpRequestException or TaskCanceledException)
    {
        await Fail(context, error);
    }
}

// Step 5. Where the gateway returns the payer after a 3DS challenge, with a POST. It is not a page,
// because a page cannot be delivered by POST and still be reloadable: the signature is checked here
// and the payer is sent on to /result with the same signed parameters in the query. The browser
// carries them, but it cannot forge them — it does not know MERCHANT_CONTROL — and /result checks
// them again before it serves anything.
async Task ResultCallback(HttpContext context)
{
    var callback = new Dictionary<string, string>(StringComparer.Ordinal);

    // A GET here is nobody arriving from a payment; send them to the empty page.
    if (HttpMethods.IsPost(context.Request.Method))
    {
        if (context.Request.HasFormContentType)
        {
            try
            {
                callback = FirstValues(await context.Request.ReadFormAsync());
            }
            catch (InvalidDataException)
            {
                context.Response.StatusCode = StatusCodes.Status400BadRequest;
                await WriteText(context, "malformed callback");
                return;
            }
        }

        // Read off the body and never off the query, so the four values verified here are the four
        // forwarded below — the servlet container in the Spring Boot example fills @RequestParam
        // from both, which is the trap this avoids.
        if (!Control.ValidCallback(callback, settings.MerchantControl))
        {
            log.LogError("[error] callback signature mismatch for order {OrderId}", Field(callback, "orderid"));
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            await WriteText(context, "invalid callback signature");
            return;
        }
    }

    // Built by hand rather than from a sorted map: every example puts these in the same order, so
    // the URL the payer ends up on is the same one everywhere.
    var signed = new List<string>(Control.SignedCallbackFields.Length);
    foreach (string name in Control.SignedCallbackFields)
    {
        string value = Field(callback, name);
        if (value.Length > 0)
        {
            signed.Add(Uri.EscapeDataString(name) + "=" + Uri.EscapeDataString(value));
        }
    }

    string target = basePath + "/result";
    if (signed.Count > 0)
    {
        target += "?" + string.Join('&', signed);
    }
    // 303, so the browser follows with a GET whatever it arrived with
    context.Response.StatusCode = StatusCodes.Status303SeeOther;
    context.Response.Headers.Location = target;
}

// The 3DS return page. The callback carries the outcome too, but the documentation says not to
// treat it as the status — the page looks the order up over the API instead.
async Task Result(HttpContext context)
{
    // The query is only there when the payer came through the callback. Rechecking it here is what
    // stops a hand-edited URL: without it the page would happily poll somebody else's order. No
    // query at all is fine — the page then says there is nothing to show.
    Dictionary<string, string> query = FirstValues(context.Request.Query);
    if (Field(query, "orderid").Length > 0 && !Control.ValidCallback(query, settings.MerchantControl))
    {
        log.LogError("[error] result signature mismatch for order {OrderId}", Field(query, "orderid"));
        context.Response.StatusCode = StatusCodes.Status403Forbidden;
        await WriteText(context, "invalid result signature");
        return;
    }

    await ServeView(context, "result.html");
}

async Task PublicFile(HttpContext context, string file)
{
    if (!publicFiles.TryGetValue(file, out string? contentType))
    {
        context.Response.StatusCode = StatusCodes.Status404NotFound;
        await WriteText(context, "not found");
        return;
    }

    context.Response.ContentType = contentType;
    await context.Response.Body.WriteAsync(Asset("public/" + file));
}

// Both pages are served straight out of the compiled-in files, with nothing substituted into them.
async Task ServeView(HttpContext context, string name)
{
    SecurityHeaders(context.Response);
    context.Response.ContentType = "text/html; charset=utf-8";
    await context.Response.Body.WriteAsync(Asset("views/" + name));
}

// What a payment page ought to send. The policy is worth reading as part of the example: the card
// fields are iframes from the gateway, so the SDK host has to be named in frame-src as well as in
// script-src, and everything else is denied by default.
//
// No 'unsafe-inline' anywhere, which is why the result page's script lives in public/result.js
// rather than in the markup: nothing in views/ is templated, so there is nowhere to put a nonce.
void SecurityHeaders(HttpResponse response)
{
    string[] policy =
    [
        "default-src 'none'",
        "script-src 'self' " + settings.SdkOrigin,
        "style-src 'self'",
        // The three card inputs are cross-origin iframes served by the gateway
        "frame-src " + settings.SdkOrigin,
        "connect-src 'self' " + settings.SdkOrigin,
        "img-src 'self' data:",
        "base-uri 'none'",
        "form-action 'self'",
        "frame-ancestors 'none'",
    ];
    response.Headers.ContentSecurityPolicy = string.Join("; ", policy);
    response.Headers.XContentTypeOptions = "nosniff";
    // The page carries the signed order parameters in its URL, and it is one payment's page
    response.Headers["Referrer-Policy"] = "no-referrer";
    response.Headers.CacheControl = "no-store";
}

// window.CONFIG as a script of its own: the only thing this server generates.
async Task WriteConfigJs(HttpContext context, Dictionary<string, string> config)
{
    context.Response.ContentType = "text/javascript; charset=utf-8";
    // The ticket inside is single-use, so this must never come from a cache
    context.Response.Headers.CacheControl = "no-store";
    await context.Response.WriteAsync("window.CONFIG = " + JsonSerializer.Serialize(config) + ";\n");
}

// Any gateway failure surfaces to the page as one 502 with a message.
async Task Fail(HttpContext context, Exception error)
{
    log.LogError("[error] {Message}", error.Message);
    await WriteError(context, StatusCodes.Status502BadGateway, error.Message);
}

Task WriteError(HttpContext context, int status, string message) =>
    WriteJson(context, status, new Dictionary<string, string>(StringComparer.Ordinal) { ["error"] = message });

Task WriteJson(HttpContext context, int status, object body)
{
    context.Response.StatusCode = status;
    context.Response.ContentType = "application/json";
    return context.Response.WriteAsync(JsonSerializer.Serialize(body));
}

Task WriteText(HttpContext context, string message)
{
    context.Response.ContentType = "text/plain; charset=utf-8";
    return context.Response.WriteAsync(message + "\n");
}

byte[] Asset(string name)
{
    using Stream stream = assembly.GetManifestResourceStream(name)
        ?? throw new InvalidOperationException($"{name} is not compiled into this assembly");
    using var buffer = new MemoryStream();
    stream.CopyTo(buffer);
    return buffer.ToArray();
}

// The 3DS 2.0 values the page is allowed to supply. Everything else the Sale needs — amount,
// currency, redirect_url, hosted_fields_token, client_orderid — belongs to the server, so the
// request body is filtered here rather than merged: a body naming "amount" would otherwise have
// chosen what the payer is charged.
static Dictionary<string, string> BrowserParams(Dictionary<string, string> source, HttpRequest request)
{
    string[] browserFields =
    [
        "customer_browser_info",
        "customer_browser_javascript_enabled",
        "customer_browser_java_enabled",
        "customer_browser_accept_language",
        "customer_browser_color_depth",
        "customer_browser_screen_width",
        "customer_browser_screen_height",
        "customer_browser_time_zone",
    ];

    var browser = new Dictionary<string, string>(StringComparer.Ordinal);
    foreach (string name in browserFields)
    {
        if (source.TryGetValue(name, out string? value))
        {
            browser[name] = value;
        }
    }
    // These two come from the request headers, never from the body, so the caller cannot spoof them
    browser["customer_browser_accept_header"] = Header(request, "Accept", "*/*");
    browser["customer_browser_user_agent"] = Header(request, "User-Agent", "");
    return browser;
}

// The payer's address, which the platform uses for fraud screening. Behind nginx it only arrives in
// X-Forwarded-For, so the proxy must set it — and the header is taken on trust, which is one of the
// reasons the app binds to loopback by default. Exposed straight to the internet this would let any
// caller pick the address the gateway screens.
static string ClientIp(HttpContext context)
{
    string address = context.Connection.RemoteIpAddress?.ToString() ?? "";
    string forwarded = Header(context.Request, "X-Forwarded-For", "");
    if (forwarded.Length > 0)
    {
        address = forwarded.Split(',')[0].Trim();
    }
    if (string.Equals(address, "::1", StringComparison.Ordinal))
    {
        return "127.0.0.1";
    }
    return address.StartsWith("::ffff:", StringComparison.Ordinal) ? address["::ffff:".Length..] : address;
}

static string Header(HttpRequest request, string name, string fallback)
{
    string value = request.Headers[name].ToString();
    return value.Length > 0 ? value : fallback;
}

// A form body or a query string as plain strings, keeping the first of a repeated name — so the
// value verified is the value forwarded, which is what the second check on /result depends on.
static Dictionary<string, string> FirstValues(IEnumerable<KeyValuePair<string, StringValues>> source)
{
    var values = new Dictionary<string, string>(StringComparer.Ordinal);
    foreach ((string name, StringValues value) in source)
    {
        if (!values.ContainsKey(name))
        {
            values[name] = value.Count > 0 ? value[0] ?? "" : "";
        }
    }
    return values;
}

static string Field(Dictionary<string, string> source, string name) =>
    source.TryGetValue(name, out string? value) ? value : "";

static string Hex(byte[] bytes) => Convert.ToHexString(bytes).ToLowerInvariant();
