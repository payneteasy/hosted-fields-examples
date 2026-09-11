"""OAuth 1.0a RSA-SHA256 request signing.

https://doc.payneteasy.com/integration/general_api_usage/request_authentication_methods/oauth.html
"""

import base64
import functools
import secrets
import time
from urllib.parse import quote

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa

from settings import MERCHANT_LOGIN, PRIVATE_KEY


def encode(value):
    """RFC 3986 percent encoding.

    quote() already leaves exactly the unreserved set alone — letters, digits and _.-~ — so
    ! ' ( ) * are escaped and a space becomes %20. What it does not do by default is escape a
    slash: safe='/' is the default, and with it the base string is wrong and the gateway answers
    401 with nothing to say why.
    """
    return quote(str(value), safe="")


def base_string(method, url, params):
    """The signature base string: METHOD&url&sorted-parameters, each part percent-encoded.

    It carries no secret, which is what makes it testable on its own — and it is where a signature
    usually goes wrong, because every part has to be encoded to RFC 3986 rather than to the looser
    rules the standard library applies elsewhere.
    """
    normalized = "&".join(f"{encode(key)}={encode(params[key])}" for key in sorted(params))
    return f"{method.upper()}&{encode(url)}&{encode(normalized)}"


def build_auth_header(method, url, body_params=None):
    """Builds the Authorization header for a signed API call.

    body_params are the x-www-form-urlencoded parameters of the request, if any.
    """
    oauth_params = {
        "oauth_consumer_key": MERCHANT_LOGIN,
        "oauth_nonce": secrets.token_hex(16),
        "oauth_signature_method": "RSA-SHA256",
        "oauth_timestamp": str(int(time.time())),
        "oauth_version": "1.0",
    }

    # Body parameters first, so an oauth_* name can never be taken from the request
    base = base_string(method, url, {**(body_params or {}), **oauth_params})
    signature = signing_key().sign(base.encode("utf-8"), padding.PKCS1v15(), hashes.SHA256())

    header = {**oauth_params, "oauth_signature": base64.b64encode(signature).decode("ascii")}
    # Header values are not encoded by the transport, so encode them here
    return "OAuth " + ", ".join(f'{key}="{encode(value)}"' for key, value in header.items())


@functools.cache
def signing_key():
    """The parsed signing key.

    Accepts a PKCS#8 or PKCS#1 PEM, with real newlines or with escaped \\n, so the key can also
    live on a single line in an env variable. PKCS1v15 with SHA-256 is what Go's
    rsa.SignPKCS1v15 and PHP's openssl_sign produce, and what the gateway verifies.
    """
    pem = PRIVATE_KEY.replace("\\n", "\n").encode("utf-8")
    key = serialization.load_pem_private_key(pem, password=None)
    if not isinstance(key, rsa.RSAPrivateKey):
        raise RuntimeError("the private key is not RSA, an RSA key is required")
    return key
