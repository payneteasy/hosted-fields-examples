# ruby-sinatra-js

Sinatra server for the Hosted Fields example. Read the repository-level `CLAUDE.md` first — the
rules about the shared frontend and about English apply here too.

## Shape

Three gems in the `Gemfile` and none of them for the integration: **sinatra** is the subject,
**puma** and **rackup** are what serve it, because Sinatra 4 runs on Rack 3 and brings no handler.
Do not add a fourth without a reason the example itself demonstrates — `openssl` signs,
`net/http` calls, `json`/`digest`/`securerandom` do the rest and `minitest` tests it, all from the
standard library.

| File | Role |
| --- | --- |
| `settings.rb` | environment variables plus a small `.env` reader, and the key |
| `oauth.rb` | OAuth 1.0a RSA-SHA256 signing |
| `control.rb` | the 3DS callback checksum, apart from the routes so it can be tested |
| `paynet.rb` | the three gateway calls: ephemeral ticket, sale, status |
| `app.rb` | the `Sinatra::Base` subclass, the routes, and the generated `config.js` |
| `config.ru` | what puma runs; `ruby app.rb` runs the same class |

Ruby 3.1 or newer. macOS's `/usr/bin/ruby` is 2.6 and Sinatra 4 refuses to run on it, which is
also why `e2e-tests/src/apps.ts` has a `rubyBinary()` locator and puts that ruby first on `PATH`.
`nodejs-express-js` and `python-flask-js` are the apps to compare against.

## Things that will bite

- **`OAuth.encode` is `ERB::Util.url_encode`, not `CGI.escape`.** `CGI.escape` is form encoding:
  it writes a space as `+`, and the signature then fails with a bare 401 and nothing in the reply
  to say why. `url_encode` escapes everything outside `A-Za-z0-9_.~-`, which is the unreserved set
  RFC 3986 asks for.
- **Both halves of the `Net::HTTP` timeout have to be named.** `open_timeout` and `read_timeout`
  are separate, and the one left out waits forever — which means the payer's page does too.
  Unlike Python's `urlopen`, though, `Net::HTTP` does not raise on a 4xx, so the
  "a 4xx with a JSON body is a decline" rule needs nothing special here.
- **`OpenSSL.secure_compare`, not `fixed_length_secure_compare`.** The latter raises when the
  lengths differ, which would turn a forged short `control` into a 500 instead of a 403.
- **Two rack-protection/Sinatra defaults are off in `configure`, and both fail quietly:**
  `http_origin` would answer the gateway's cross-origin 3DS POST with a 403 before the checksum
  is ever checked, and `frame_options` sends an `X-Frame-Options: SAMEORIGIN` that contradicts
  this app's own `frame-ancestors 'none'` and that no other example sends. `absolute_redirects`
  is off for a third reason: its `Location` is built from the request's scheme, so behind a
  TLS-terminating proxy the 3DS return would redirect the payer to `http://`.
- **`set :static, false`.** Sinatra's `public_folder` serves at the root, outside `BASE_PATH`,
  which would put the assets on two URLs. `public/` goes out through the `STATIC_FILES` allowlist
  route instead, which is also what keeps `views/`, `.env`, `Gemfile` and the sources unreachable.
  That route is declared **last**, after `/config.js` and `/result`, because Sinatra matches in
  declaration order.
- **Nothing in `views/` is templated.** Both pages go out through `send_view`, and the only
  generated thing is `config.js` (`send_config_js`). `erb` is one method call away here, which
  makes this the second easiest example to break after Flask: using it on a view would end the
  promise that the same HTML serves from every one of them.
- **`views/` and `public/` are copies of `shared/`.** Edit `shared/`, run
  `scripts/sync-shared.sh`. CI fails a copy that has drifted.
- **`Gemfile.lock` has to name every platform a target runs on.** Bundler resolves per platform
  and refuses to install — exit 16, "your bundle only supports platforms …" — when the lock does
  not list the one it is on. A lock written on a Mac carries only `arm64-darwin-*`, which fails on
  a Linux CI and on a Linux server, so the committed one names the linux and darwin platforms plus
  the generic `ruby`. Re-lock with `bundle lock --add-platform`, never by deleting the file.
- **The tests run outside the bundle.** minitest is a *bundled* gem, so `bundle exec` hides it
  unless the `Gemfile` names it — and the `Gemfile` should not, because the tests touch no gem at
  all. `ruby test/all.rb`, never `bundle exec ruby test/all.rb`.
- **Settings are validated when `settings.rb` is required**, which is the startup for both
  `ruby app.rb` and puma. That is why the tests call `SettingsStub.apply` *before* the
  `require_relative` of the module under test, exactly as `nodejs-express-js` does.

## Checks

```bash
ruby -c *.rb config.ru test/*.rb   # every file, there is no build step
ruby test/all.rb                   # no bundle exec, see below
```

Ruby 3.1 or newer; neither wants credentials.
