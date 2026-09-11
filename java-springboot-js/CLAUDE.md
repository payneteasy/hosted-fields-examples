# java-springboot-js

Spring Boot server for the Hosted Fields example. Read the repository-level `CLAUDE.md` first — the
rules about the shared frontend and about English apply here too.

## Shape

One runtime dependency, `spring-boot-starter-web`, and it is the subject of the example. Nothing is
added for the integration: `java.net.http` calls the gateway, `java.security` signs,
`MessageDigest`, `HexFormat` and `SecureRandom` do the rest. The build adds three more —
`spring-boot-starter-test`, `jspecify`, and Spotless with Error Prone/NullAway — and none of them
ships in the jar's own code. Do not add a fourth without a reason the example itself demonstrates.

| File | Role |
| --- | --- |
| `Settings.java` | environment variables plus a small `.env` reader, and the key |
| `OAuth.java` | OAuth 1.0a RSA-SHA256 signing |
| `Control.java` | the 3DS callback checksum, apart from the routes so it can be tested |
| `Paynet.java` | the three gateway calls: ephemeral ticket, sale, status |
| `GatewayException.java` | a call that produced no answer. A decline is not one |
| `Routes.java` | the routes under `BASE_PATH`, and the generated `config.js` |
| `Application.java` | `main`: load and validate the settings, then start the container |

JDK 21 or newer, and no Maven: `./mvnw` is the wrapper and fetches its own. `views/` and `public/`
are packaged into the jar by the two extra `<resource>` directories in `pom.xml`, so the artefact
is one file with nothing beside it — the counterpart of `go-js`'s `//go:embed`, and `go-js` is the
example to compare against.

## Things that will bite

- **`OAuth.encode` is not `URLEncoder.encode`.** `URLEncoder` is form encoding: it writes a space
  as `+` and leaves `*` alone, and the signature then fails with a bare 401 and nothing in the
  reply to say why. RFC 3986 wants everything outside `A-Za-z0-9-._~` escaped, per UTF-8 byte.
  `Paynet.formEncode` *is* `URLEncoder`, because the request body really is form encoded — the
  asymmetry is deliberate and both halves are needed.
- **`KeyFactory` reads PKCS#8 and nothing else.** A PKCS#1 key — header `BEGIN RSA PRIVATE KEY` —
  needs `openssl pkcs8 -topk8 -nocrypt` first, and `OAuth.parsePrivateKey` says so by name rather
  than failing with a base64 error. Go accepts both; the JDK does not, and wrapping PKCS#1 by hand
  would be clever where this repository wants clear.
- **Both halves of the HTTP timeout have to be named.** `HttpClient.connectTimeout` does not cover
  waiting for the reply — `HttpRequest.timeout` does — and the one left out waits forever, which
  means the payer's page does too. Unlike Python's `urlopen`, though, `java.net.http` does not
  throw on a 4xx, so the "a 4xx with a JSON body is a decline" rule needs nothing special here.
- **`spring.web.resources.add-mappings=false`.** `scripts/sync-shared.sh` puts the client scripts
  in `public/`, `pom.xml` packages that at `classpath:/public/`, and that is one of the four
  locations Spring Boot serves by itself. Left on, the framework would serve them a second way,
  outside the allowlist in `Routes.asset` and with its own caching headers.
- **The 3DS callback body is parsed by hand, not with `@RequestParam`.** The servlet container
  fills those from the query string as well as the body, so `?orderid=…` on the callback URL would
  be verified and forwarded along with it. The four values that are checked have to be the four
  that are forwarded — the same reason `php-js` parses forms itself instead of using `$_POST`.
- **Settings are loaded in `main`, not in a `@ConfigurationProperties` bean.** The port, the
  interface and `BASE_PATH` decide how the servlet container is built, so a bean would be too late;
  `BASE_PATH` is the context path, which is also where Tomcat's redirect from the bare prefix to
  the trailing-slash form comes from. Nothing is validated at class initialisation, which is why
  `./mvnw verify` needs no credentials and the tests stub nothing.
- **A record prints every component.** `Settings` holds the private key, so it overrides
  `toString()`; the generated one would put the key in any log line or stack trace that mentions
  the settings.
- **Nothing in `views/` is templated.** Both pages are read out of the jar and written byte for
  byte, and the only generated thing is `config.js` (`Routes.configJs`). No template engine is on
  the classpath and none should go there: adding one would end the promise that the same HTML
  serves from every example.
- **`views/` and `public/` are copies of `shared/`.** Edit `shared/`, run
  `scripts/sync-shared.sh`. CI fails a copy that has drifted. They are also `<resource>`
  directories in `pom.xml`, so a change to either needs a rebuild before it shows.

## Checks

```bash
./mvnw -Perrorprone compile   # Error Prone and NullAway, the counterpart of `go vet`
./mvnw verify                 # spotless:check, the tests, and the jar
./mvnw spotless:apply         # what to run when the check above fails
```

JDK 21 or newer; none of them wants credentials.
