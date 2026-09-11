# kotlin-ktor-js

Kotlin server for the Hosted Fields example, on Ktor. Read the repository-level `CLAUDE.md` first —
the rules about the shared frontend and about English apply here too.

## Shape

Two dependencies, and one of them is the subject: Ktor, and kotlinx.serialization because the JVM
has no JSON of its own. Everything the integration itself needs is in the JDK — `java.net.http`
calls the gateway, `java.security` signs, `MessageDigest`, `HexFormat` and `SecureRandom` do the
rest. Keep it that way.

| File | Role |
| --- | --- |
| `Settings.kt` | environment variables plus a small `.env` reader, since the JVM has no `--env-file` |
| `OAuth.kt` | OAuth 1.0a RSA-SHA256 signing |
| `Control.kt` | the 3DS callback checksum |
| `Paynet.kt` | the three gateway calls |
| `Routing.kt` | routes under `BASE_PATH`, and the generated `config.js` |
| `Application.kt` | `main`: settings, then the engine |

`views/` and `public/` are packaged into the fat jar by `processResources`, so the artefact is one
file with nothing beside it. Change a page and you have to rebuild — there is nothing to edit on a
server.

## Things that will bite

- **Ktor has no context path.** The page is registered at `{prefix}/` and the bare prefix answers
  a `301` from a route of its own — the redirect Go's mux and Tomcat send for free. The pages carry
  relative `href="styles.css"`, which resolves one segment too high without the trailing slash.
  **Do not install `IgnoreTrailingSlash`**: it makes the two the same route and takes the redirect
  away.
- **`staticResources` is never installed.** `public/` goes out through the four-name `ASSETS`
  allowlist in `Routing.kt`; left to itself Ktor would serve the class files and `views/` too. This
  is the counterpart of `spring.web.resources.add-mappings=false` and of Sinatra's `static`.
- **`AutoHeadResponse` is installed**, because Go's mux and Tomcat answer HEAD wherever they answer
  GET and this example has to agree.
- **`java.net.http`'s `send` is blocking and a Ktor handler runs on a Netty event-loop thread.**
  Every gateway call goes out inside `withContext(Dispatchers.IO)`. Dropping that stalls every
  other request the server is serving, and nothing in a test will say so.
- **`OAuth.encode` is not `URLEncoder.encode` and not `encodeURLParameter`.** The signature needs
  RFC 3986: a space is `%20`, not `+`, and `!'()*` must be escaped. `Paynet.formEncode` *is*
  `URLEncoder`, because the request body really is form encoded — the asymmetry is deliberate and
  both halves are required.
- **Settings are read once, in `main`, before the engine is built.** Not lazily out of an object
  initialiser: the process has to refuse to start on a missing credential, and `./gradlew build`
  has to run with none.
- **Gateway replies are JSON** because the request asks for it with
  `Accept: application/vnd.pay+json`. A rejected request comes back as 4xx **with a JSON body**
  carrying `error-message`, so `postJson` decodes whatever the status and only treats a non-JSON
  reply as a failed call.
- **The 3DS callback is parsed off the body by hand**, so the four values verified are provably
  the four forwarded.
- **Nothing in `views/` is templated.** Both pages are read out of the jar and written byte for
  byte, and the only generated thing is `config.js`. There is no template engine on the classpath;
  keep it that way.
- **`views/` and `public/` are copies of `shared/`.** Edit `shared/`, run
  `scripts/sync-shared.sh`. CI fails a copy that has drifted.
- **`gradle/wrapper/gradle-wrapper.jar` is the one binary in the repository.** Gradle has no
  script-only wrapper the way Maven does. The distribution it fetches is pinned by SHA-256 in
  `gradle-wrapper.properties`, and CI runs `gradle/actions/wrapper-validation` over the jar. Do not
  regenerate it without the checksum line.

## Checks

```bash
./gradlew ktlintCheck   # the counterpart of gofmt; ktlintFormat fixes
./gradlew build         # allWarningsAsErrors, the vectors, then the jar
./gradlew buildFatJar   # hosted-fields-example-kotlin.jar, the release artefact
```

JDK 21 or newer. Nothing else has to be installed.
