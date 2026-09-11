# rust-axum-js

Rust server for the Hosted Fields example, on axum. Read the repository-level `CLAUDE.md` first —
the rules about the shared frontend and about English apply here too.

## Shape

A port of `go-js/`, file for file. Rust has no HTTP server in the standard library, so this one
has dependencies where the Go example has none — but only for the server half, and every one of
them is named in `Cargo.toml` with the reason.

| File | Role |
| --- | --- |
| `src/config.rs` | environment variables plus a small `.env` reader |
| `src/oauth.rs` | OAuth 1.0a RSA-SHA256 signing |
| `src/control.rs` | the checksum the gateway signs its 3DS callbacks with |
| `src/paynet.rs` | the three gateway calls: ephemeral ticket, sale, status |
| `src/main.rs` | routes under `BASE_PATH`, and the generated `config.js` |

`views/` and `public/` are compiled in with `include_dir!`, so the artefact is one binary with no
files beside it. Change a page and you have to rebuild — there is nothing to edit on a server.

## Things that will bite

- **`Router::nest` maps the mounted router's `/` onto the *bare* prefix**, not onto
  `{prefix}/`. So the payment page is registered outside the nest, at the trailing-slash form —
  which is the one the views' relative asset URLs resolve against — and the bare prefix answers a
  `301` to it. Nesting the page instead leaves `{prefix}/` a 404 and every asset URL one path
  segment too high.
- **`encode` in `oauth.rs` is not a form encoder.** The signature needs RFC 3986: a space is
  `%20`, not `+`, and `!'()*` must be escaped. `form_urlencoded` produces a signature the gateway
  rejects. The Sale *body* really is form encoded — that is what `.form(params)` in `paynet.rs`
  is for, and the two must not be swapped.
- **The 3DS callback body is parsed by hand**, with `form_urlencoded` over the body and never
  over the query, so that the four values that are verified are the four that are forwarded.
  Repeated names keep the first value, in the callback body and in the `/result` query alike.
- **Settings are parsed and validated in `main`, before the listener is opened.** Nothing reads
  the environment lazily out of a `static`: a missing credential has to stop the process, not
  surface later as a payment page that cannot take a payment. `cargo test` and `cargo build` need
  no credentials at all.
- **Gateway replies are JSON** because the request asks for it with
  `Accept: application/vnd.pay+json`. A rejected request comes back as 4xx **with a JSON body**
  carrying `error-message`, so `post_json` decodes whatever the status and only treats a non-JSON
  reply as a failed call — including the ephemeral ticket, which arrives as JSON with the rest
  and is read out of `ephemeralTicket`.
- **Nothing in `views/` is templated.** Both pages are served straight out of the compiled-in
  files, and the only generated thing is `config.js` (`write_config_js` in `main.rs`).
- **`views/` and `public/` are copies of `shared/`.** Edit `shared/`, run
  `scripts/sync-shared.sh`. CI fails a copy that has drifted.

## Dependencies

Two of them are chosen rather than defaulted, and changing either brings back what it was picked
to avoid:

- **reqwest with `default-features = false`** and `rustls-no-provider`. The default features are
  native-tls, which is OpenSSL; the plain `rustls` feature picks aws-lc-rs, which needs cmake
  installed to build. The provider is ring, installed in `main`. The client carries an
  **explicit 10-second timeout** because reqwest has no default one.
- **`rsa` + `sha2` + `sha1`**, pure Rust, never bindings to OpenSSL.

`X-Forwarded-For` is read by hand, five lines in `main.rs`, taking the **last** element: nginx
appends the address it saw, so that is the one element the caller could not choose. A crate would
hide that decision behind defaults worth going to read.

## Checks

```bash
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
cargo build --release
```

Rust 1.85 or newer, for the 2024 edition.
