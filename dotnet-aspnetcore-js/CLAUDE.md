# dotnet-aspnetcore-js

.NET server for the Hosted Fields example, on ASP.NET Core minimal APIs. Read the
repository-level `CLAUDE.md` first — the rules about the shared frontend and about English apply
here too.

## Shape

A port of `go-js/`, file for file. No NuGet package is referenced and none should be: Kestrel,
`HttpClient`, RSA, SHA-1 and `System.Text.Json` all ship with the platform, so the example keeps
the Go one's property that the integration needs nothing but the standard library. xUnit under
`tests/` is the only exception, and it is not part of what is published.

| File | Role |
| --- | --- |
| `Settings.cs` | environment variables plus a small `.env` reader |
| `OAuth.cs` | OAuth 1.0a RSA-SHA256 signing |
| `Control.cs` | the checksum the gateway signs its 3DS callbacks with |
| `Paynet.cs` | the three gateway calls: ephemeral ticket, sale, status |
| `Program.cs` | routes under `BASE_PATH`, and the generated `config.js` |

`views/` and `public/` are compiled in as `<EmbeddedResource>` with an explicit `LogicalName`, so
the published app is one assembly with no files beside it — the analogue of `//go:embed`,
`include_dir!` and the Java example's jar. Change a page and you have to rebuild.

There is no solution file, on purpose: one `.csproj` in this directory means `dotnet run` works
bare, and the test project is named explicitly wherever it is needed.

## Things that will bite

- **The bare prefix is redirected in middleware, not by a route.** ASP.NET Core's endpoint matcher
  ignores a trailing slash, so `{prefix}` and `{prefix}/` reach the same endpoint — and the views'
  relative asset URLs (`styles.css`, `config.js`) would then resolve one path segment too high.
  The four-line middleware at the top of `Program.cs` answers an exact `{prefix}` with a `301` to
  `{prefix}/`, which is the redirect Go's mux, Tomcat and nginx all send by themselves. It is
  registered before anything else, so it short-circuits whatever routing has already selected. The
  payment page itself is registered at the bare prefix and reached at the trailing-slash form.
- **`MapGet` maps GET and nothing else**, so a `HEAD` would be answered `405` — this example
  alone, since Go's `ServeMux`, Express and the rest all serve `HEAD` from their `GET` route.
  Every GET route here goes through the one-line `Get` helper in `Program.cs`, which is
  `MapMethods(…, ["GET", "HEAD"], …)`. Kestrel drops the body of a HEAD response itself, so the
  handlers know nothing about it.
- **No `UseStaticFiles`, no `wwwroot`, no static web assets.** `public/` goes out through the
  four-name allowlist in `Program.cs` and nowhere else. Left to itself the framework would serve
  the client scripts a second way, at the root rather than under `BASE_PATH` and with caching
  headers of its own — which is what `spring.web.resources.add-mappings: false` in the Spring Boot
  example and `set :static, false` in the Sinatra one exist to prevent. `StaticWebAssetsEnabled`
  is `false` in the csproj for the same reason.
- **The environment is pinned to `Production`** in `WebApplicationOptions`, not taken from
  `ASPNETCORE_ENVIRONMENT`. In Development the framework inserts the developer exception page:
  stack traces behind a payment page, and an injected inline script that the
  Content-Security-Policy has no `'unsafe-inline'` for. Flask's `debug` stays off for the same
  reason.
- **`OAuth.Encode` is not a form encoder.** The signature needs RFC 3986: a space is `%20`, not
  `+`, and `!'()*` must be escaped. `Uri.EscapeDataString` is close but not the thing to reach
  for here — the encoder is written out so the rule is visible. The Sale *body* really is form
  encoded, which is what `FormUrlEncodedContent` in `Paynet.cs` is for, and the two must not be
  swapped.
- **The 3DS callback is parsed off the body**, with `ReadFormAsync` behind a `HasFormContentType`
  guard and never off the query — the servlet container in the Spring Boot example fills
  `@RequestParam` from both, which is the trap this avoids. The four values verified are the four
  forwarded, and a repeated name keeps its first value.
- **Gateway replies are JSON** because the request asks for it with
  `Accept: application/vnd.pay+json`. A rejected request comes back as 4xx **with a JSON body**
  carrying `error-message`, so `PostJsonAsync` decodes whatever the status and only treats a
  non-JSON reply as a failed call — including the ephemeral ticket, which arrives as JSON with the
  rest and is read out of `ephemeralTicket`. The reply is a `Dictionary<string, JsonElement>` and
  never a model class: `paynet-order-id` is a number in a sale reply and a string elsewhere.
- **Settings are loaded and validated in `Main`**, before the listener is opened. Nothing reads the
  environment lazily out of a static: a missing credential has to stop the process, not surface
  later as a payment page that cannot take a payment. `dotnet build` and `dotnet test` need no
  credentials at all.
- **Nothing in `views/` is templated.** Both pages are written out of the embedded resources byte
  for byte, and the only generated thing is `config.js` (`WriteConfigJs` in `Program.cs`).
- **`views/` and `public/` are copies of `shared/`.** Edit `shared/`, run
  `scripts/sync-shared.sh`. CI fails a copy that has drifted.

`X-Forwarded-For` is read by hand, five lines in `Program.cs`, taking the **first** element — as
Go, Express, PHP, Flask, Sinatra, Spring Boot and Next all do. `UseForwardedHeaders` would hide
that decision behind defaults worth going to read, and would need a known-proxy list to do
anything at all.

## Checks

```bash
dotnet format HostedFields.csproj --verify-no-changes
dotnet format tests/HostedFields.Tests.csproj --verify-no-changes
dotnet build HostedFields.csproj -c Release
dotnet test tests/HostedFields.Tests.csproj
dotnet publish HostedFields.csproj -c Release
```

`dotnet format` is this example's gofmt, and `TreatWarningsAsErrors` with the SDK's analysers is
its `go vet`. .NET 10 or newer.

The end-to-end suite runs this app only when it is asked for — `cd e2e-tests && npm run test:dotnet`
— because `onRequestOnly: true` in `e2e-tests/src/apps.ts` keeps it out of a bare `npm test`: a
missing toolchain fails the whole suite there rather than skipping one app.
