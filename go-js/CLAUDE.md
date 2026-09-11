# go-js

Go server for the Hosted Fields example. Read the repository-level `CLAUDE.md` first — the rules
about the shared frontend and about English apply here too.

## Shape

Standard library only, no dependencies, `go.mod` has no `require` block. Keep it that way: the
point of the example is that the integration needs nothing but the stdlib.

| File | Role |
| --- | --- |
| `config.go` | environment variables plus a small `.env` reader, since Go has no `--env-file` |
| `oauth.go` | OAuth 1.0a RSA-SHA256 signing |
| `paynet.go` | the three gateway calls: ephemeral ticket, sale, status |
| `main.go` | routes, all mounted under `BASE_PATH` |

`views/` and `public/` are compiled in with `//go:embed`, so the artefact is one static binary
with no files beside it. Change a template and you have to rebuild — there is nothing to edit on
a server.

## Things that will bite

- **Settings are read once, in `loadConfig`, not in package-level vars.** Package-level
  initialisation runs before `main`, so a `var` reading `os.Getenv` would run before `.env` is
  loaded and silently take the default.
- **`encode` in `oauth.go` is not `url.QueryEscape`.** The signature needs RFC 3986: a space is
  `%20`, not `+`, and `!'()*` must be escaped. Using the stdlib escaper produces a signature the
  gateway rejects.
- **Gateway replies are JSON** because the request asks for it with
  `Accept: application/vnd.pay+json`. A rejected request comes back as 4xx **with a JSON body**
  carrying `error-message`, so `postJSON` decodes whatever the status and only treats a non-JSON
  reply as a failed call. The ephemeral ticket is the one reply that stays plain text.
- **`html/template` serialises the config map to JSON itself** in the `window.CONFIG = {{ . }}`
  line. Do not marshal it by hand.

## Checks

```bash
gofmt -l .        # must print nothing
go vet ./...
go build ./...
```

Go 1.24 or newer.
