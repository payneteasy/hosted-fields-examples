# php-js

PHP server for the Hosted Fields example. Read the repository-level `CLAUDE.md` first — the rules
about the shared frontend and about English apply here too.

## Shape

No Composer, no framework, no autoloader, no `vendor/`. Plain functions in six files, each
`require_once`ing what it uses. Keep it that way: the point of the example is that the
integration needs nothing but PHP and its bundled `curl`, `openssl` and `json`.

| File | Role |
| --- | --- |
| `settings.php` | environment variables plus a small `.env` reader, and the key |
| `oauth.php` | OAuth 1.0a RSA-SHA256 signing |
| `control.php` | the 3DS callback checksum, apart from the routes so it can be tested |
| `paynet.php` | the three gateway calls: ephemeral ticket, sale, status |
| `index.php` | routes under `BASE_PATH`, and the generated `config.js` |
| `router.php` | the `php -S` entry point; nginx goes straight to `index.php` |

PHP 8.4, `declare(strict_types=1)` in every file.

## Things that will bite

- **`router.php` must never `return false`.** That hands the request back to the built-in
  server, and the app root is its document root — so `.env` would be served and `paynet.php`
  executed directly. `index.php` answers every path itself and serves `public/` from the
  `STATIC_FILES` allowlist, which is also why the nginx location block has no `root` and no
  `try_files`.
- **`oauth_encode` is `rawurlencode`, not `urlencode`.** The signature needs RFC 3986: a space
  is `%20`, not `+`. `urlencode` produces a signature the gateway rejects with nothing in the
  reply to say why.
- **Every `ksort` here is `ksort($array, SORT_STRING)`.** The default compares numeric-looking
  keys as numbers, so it would put `10` before `9` where the gateway and every other example
  sort bytes.
- **Forms are parsed by `form_params()`, not by `$_POST` or `$_GET`.** PHP rewrites `.` and a
  space in a parameter name and keeps the last of a repeated one, where Go and Node keep the
  first. The 3DS return is verified and then forwarded, and those have to be the same value.
- **Settings are validated per request, in `settings()`.** PHP has no startup, so there is no
  boot to refuse — a missing name is a `500` with the detail in the log. Nothing may move that
  check to module level: the tests and `php -l` have to run without credentials.
- **Gateway replies are JSON** because the request asks for it with
  `Accept: application/vnd.pay+json`. A rejected request comes back as 4xx **with a JSON body**
  carrying `error-message`, so `paynet_post_json` decodes whatever the status and only treats a
  non-JSON reply as a failed call — including the ephemeral ticket, which arrives as JSON with
  the rest and is read out of `ephemeralTicket`.
- **`json_encode` needs asking for what Go does by default.** `JSON_HEX_TAG | JSON_HEX_AMP` for
  the HTML-significant characters, `JSON_UNESCAPED_SLASHES` because Go does not escape `/`, and
  `JSON_UNESCAPED_UNICODE` because Go writes UTF-8. With a sorted array that makes `config.js`
  byte for byte the script the other examples emit. (PHP writes the hex of an escape in upper
  case and Go in lower; no value this app emits contains one.)
- **Nothing in `views/` is templated.** Both pages are read off disk and written out unchanged,
  and the only generated thing is `config.js` (`send_config_js` in `index.php`). Reintroducing a
  template would break the promise that the same HTML serves from every example.
- **`views/` and `public/` are copies of `shared/`.** Edit `shared/`, run
  `scripts/sync-shared.sh`. CI fails a copy that has drifted.

## Checks

```bash
php -l *.php tests/*.php   # every file, there is no build step
php tests/run.php
```

PHP 8.4 or newer, with `curl`, `openssl` and `json`.
