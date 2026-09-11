# python-flask-js

Flask server for the Hosted Fields example. Read the repository-level `CLAUDE.md` first — the
rules about the shared frontend and about English apply here too.

## Shape

Two runtime dependencies and one for deploy, all in `requirements.txt`: **Flask** because it is
the subject, **cryptography** because Python has no RSA, **gunicorn** because the systemd unit
runs it. Do not add a fourth without a reason the example itself demonstrates — the gateway calls
are `urllib.request` and the tests are `unittest` on purpose.

| File | Role |
| --- | --- |
| `settings.py` | environment variables plus a small `.env` reader, and the key |
| `oauth.py` | OAuth 1.0a RSA-SHA256 signing |
| `control.py` | the 3DS callback checksum, apart from the routes so it can be tested |
| `paynet.py` | the three gateway calls: ephemeral ticket, sale, status |
| `app.py` | one blueprint under `BASE_PATH`, and the generated `config.js` |

Python 3.12 or newer. `nodejs-express-js` is the app to compare against: it is the other example
built on a framework, and every route here is a transcription of one of its.

## Things that will bite

- **`urllib.error.HTTPError` carries the reply body.** `urlopen` raises on every 4xx, and a
  rejected request *is* a 4xx with a JSON body holding `error-message`. `_post` in `paynet.py`
  reads `error.read()` and `error.code` and feeds them into the same decode path as a 200; only a
  body that is not a JSON object is a failed call. Letting the exception propagate would turn
  every decline into a `502`.
- **`encode` is `quote(value, safe='')`.** `quote`'s always-safe set is already the unreserved
  one, so `!'()*` are escaped and a space is `%20` — but the **default `safe='/'`** would leave
  slashes alone, and the base string encodes a whole URL as one parameter. Bodies go out through
  `urlencode`, which writes `+` for a space, like every other example.
- **`json.dumps` needs telling.** `separators=(',', ':')` because the default writes a space
  after each one, and `ensure_ascii=False` because the default writes `\uXXXX`; neither is what
  `JSON.stringify` emits. Keys come out in insertion order, as in the Express example — Go and
  PHP sort theirs.
- **No global `errorhandler`.** Express reaches its 502 through `next(error)`, but a Flask
  `errorhandler(Exception)` also catches Werkzeug's `NotFound` and would turn every 404 into a
  502. The two handlers that call the gateway use `try/except` and `fail()` instead.
- **`debug` stays off**, in `app.run` and everywhere else. The Werkzeug debugger is remote code
  execution sitting behind a payment page, and the scripts it injects would breach the
  Content-Security-Policy as well.
- **The headers go on the response `send_from_directory` returns**, not before it: it sets a
  `Cache-Control` of its own, and `no-store` has to replace it.
- **Settings are validated at import**, in `settings.py`, which is the startup for both
  `python app.py` and gunicorn. That is why the tests call `stub_settings()` *before* importing
  the module under test, exactly as `nodejs-express-js` does.
- **Nothing in `views/` is templated.** Both pages go out through `send_view`, and the only
  generated thing is `config.js` (`send_config_js`). Jinja is in the box here, which makes this
  the easiest example to break: reintroducing a template would end the promise that the same HTML
  serves from every one of them.
- **`views/` and `public/` are copies of `shared/`.** Edit `shared/`, run
  `scripts/sync-shared.sh`. CI fails a copy that has drifted.
- **`public/` is mounted with `static_url_path=BASE_PATH`**, so `styles.css` is served at the
  prefix and `views/` is unreachable as a file. `/config.js` still wins over the static
  `<path:filename>` because Werkzeug ranks a rule with no arguments first — worth knowing before
  adding a route with a converter in it.

## Checks

```bash
python -m compileall -q -x '(\.venv|__pycache__)' .
python -m unittest discover -s tests -t .
```

Both want `requirements.txt` installed; neither wants credentials.
