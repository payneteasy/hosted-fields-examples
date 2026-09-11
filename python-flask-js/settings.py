"""All settings come from the environment, see .env.example.

The five gateway settings are validated when this module is imported, which for `flask run` and
for gunicorn is the startup: the app refuses to boot rather than serving a page that cannot take a
payment. `python -m compileall` does not import, and the tests stub the environment, so neither
needs credentials.
"""

import os
from pathlib import Path
from urllib.parse import urlsplit

APP_DIR = Path(__file__).resolve().parent
# Copies of shared/, kept in step by scripts/sync-shared.sh. public/ is web-reachable and views/
# is not: the two pages are read and sent by app.py, never served as files.
PUBLIC_DIR = APP_DIR / "public"
VIEWS_DIR = APP_DIR / "views"


def _read_env_file(path):
    """Reads a KEY=value file, the way `node --env-file` does. A missing file is not an error.

    Nothing here touches os.environ: the values are returned and consulted *after* the real
    environment, which is what lets a harness drive the app without writing an .env and keeps a
    stale .env from winning over what the process was started with. It is also why python-dotenv
    is not a dependency.
    """
    values = {}
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return values

    for line in lines:
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        # The first = separates, so a value may contain more of them
        name, separator, value = line.partition("=")
        if not separator:
            continue
        values[name.strip()] = value.strip().strip("\"'")

    return values


_ENV_FILE = _read_env_file(APP_DIR / ".env")


def env(name, fallback=""):
    """One setting: the real environment first, then .env, then the fallback.

    An empty value counts as unset, so a copied .env.example fails with a message naming what is
    missing rather than half working.
    """
    return os.environ.get(name) or _ENV_FILE.get(name) or fallback


def _origin(url):
    """Scheme, host and port of a URL, or '' when it is not one."""
    parts = urlsplit(url)
    return f"{parts.scheme}://{parts.netloc}" if parts.scheme and parts.netloc else ""


def _private_key():
    """The signing key, as text. A path is tried first, and one that cannot be read is fatal."""
    path = env("PRIVATE_KEY_PATH")
    if path:
        return Path(path).read_text(encoding="utf-8")
    return env("PRIVATE_KEY")


PORT = int(env("PORT", "3004"))
# Interface to listen on. The default is loopback: the example speaks plain HTTP and trusts
# X-Forwarded-For, both of which are only safe with a proxy in front. Set 0.0.0.0 knowingly.
LISTEN_ADDR = env("LISTEN_ADDR", "127.0.0.1")
BASE_PATH = env("BASE_PATH", "/hosted-fields-examples-python")
PUBLIC_URL = env("PUBLIC_URL", f"http://localhost:{PORT}")

# No defaults: the gateway host is per-installation, and a stale one baked in here would silently
# point a real payment somewhere it does not belong. Required below.
API_URL = env("API_URL")
SDK_URL = env("SDK_URL")
# Origin of SDK_URL, scheme and host only: the Content-Security-Policy has to name the host the
# SDK bundle and the card iframes come from, and nothing else.
SDK_ORIGIN = _origin(SDK_URL)

ENDPOINT_ID = env("ENDPOINT_ID")
MERCHANT_LOGIN = env("MERCHANT_LOGIN")
# Shared secret the gateway signs its callbacks with. Not the RSA key.
MERCHANT_CONTROL = env("MERCHANT_CONTROL")
# The key is a multi-line PEM, which neither systemd's EnvironmentFile nor most secret stores
# handle well, so a path is the deployment-friendly form and the inline value the local one.
PRIVATE_KEY = _private_key()

ORDER_AMOUNT = env("ORDER_AMOUNT", "1.00")
ORDER_CURRENCY = env("ORDER_CURRENCY", "USD")

# Where the gateway sends the payer back after a 3DS challenge. It POSTs there, so this is
# /result/callback and not the /result page the callback then redirects to. Built from PUBLIC_URL,
# because behind a proxy the listen address is not what the payer's browser sees.
REDIRECT_URL = f"{PUBLIC_URL}{BASE_PATH}/result/callback"

for _name, _value in {
    "API_URL": API_URL,
    "SDK_URL": SDK_URL,
    "ENDPOINT_ID": ENDPOINT_ID,
    "MERCHANT_LOGIN": MERCHANT_LOGIN,
    "MERCHANT_CONTROL": MERCHANT_CONTROL,
}.items():
    if not _value:
        raise RuntimeError(f"{_name} is not set, see .env.example")

if not PRIVATE_KEY:
    raise RuntimeError("Set PRIVATE_KEY_PATH or PRIVATE_KEY, see .env.example")
