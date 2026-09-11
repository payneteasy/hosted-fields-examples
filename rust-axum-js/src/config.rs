//! Settings, all of them environment variables. See `.env.example`.

use std::collections::HashMap;
use std::fs;
use std::io::ErrorKind;

use reqwest::Url;
use rsa::RsaPrivateKey;
use rsa::pkcs1::DecodeRsaPrivateKey;
use rsa::pkcs8::DecodePrivateKey;

use crate::Result;

pub struct Config {
    pub port: u16,
    /// Interface to listen on. The default is loopback: the example speaks plain HTTP and trusts
    /// X-Forwarded-For, both of which are only safe with a proxy in front. Set 0.0.0.0 knowingly.
    pub listen_addr: String,
    /// URL prefix everything is mounted under.
    pub base_path: String,
    /// Origin the payer's browser sees, no path.
    pub public_url: String,
    pub api_url: String,
    pub sdk_url: String,
    /// Origin of `sdk_url`, scheme and host only: the Content-Security-Policy has to name the
    /// host the SDK bundle and the card iframes come from, and nothing else.
    pub sdk_origin: String,
    pub endpoint_id: String,
    pub merchant_login: String,
    /// Shared secret the gateway signs its callbacks with. Not the RSA key.
    pub merchant_control: String,
    pub order_amount: String,
    pub order_currency: String,
    /// Signs the server calls, never leaves the server.
    pub private_key: RsaPrivateKey,
}

impl Config {
    /// Reads and validates everything. Called once from `main`, before the server is built: a
    /// missing setting has to stop the process rather than surface as a broken payment later.
    pub fn load(env_file: &str) -> Result<Config> {
        let env = Env::load(env_file)?;

        let port = env.get("PORT", "3007");
        let port: u16 = port
            .parse()
            .map_err(|_| format!("PORT is {port}, which is not a port number"))?;

        let config = Config {
            port,
            listen_addr: env.get("LISTEN_ADDR", "127.0.0.1"),
            base_path: env.get("BASE_PATH", "/hosted-fields-examples-rust"),
            // Computed after the port, so that it follows a custom one
            public_url: env.get("PUBLIC_URL", &format!("http://localhost:{port}")),
            // No default: the gateway host is per-installation, and a stale one baked in here
            // would silently point a real payment somewhere it does not belong. Required below.
            api_url: env.get("API_URL", ""),
            sdk_url: env.get("SDK_URL", ""),
            sdk_origin: String::new(),
            endpoint_id: env.get("ENDPOINT_ID", ""),
            merchant_login: env.get("MERCHANT_LOGIN", ""),
            merchant_control: env.get("MERCHANT_CONTROL", ""),
            order_amount: env.get("ORDER_AMOUNT", "1.00"),
            order_currency: env.get("ORDER_CURRENCY", "USD"),
            private_key: read_private_key(&env)?,
        };

        for (name, value) in [
            ("API_URL", &config.api_url),
            ("SDK_URL", &config.sdk_url),
            ("ENDPOINT_ID", &config.endpoint_id),
            ("MERCHANT_LOGIN", &config.merchant_login),
            ("MERCHANT_CONTROL", &config.merchant_control),
        ] {
            if value.is_empty() {
                return Err(format!("{name} is not set, see .env.example").into());
            }
        }

        // The policy is built from this, so an unusable SDK_URL is a startup error rather than a
        // `frame-src ` with nothing after it and card fields that never load.
        Ok(Config {
            sdk_origin: sdk_origin(&config.sdk_url)?,
            ..config
        })
    }

    /// Where the payer lands after a 3DS challenge. Built from `PUBLIC_URL`, not from the listen
    /// address, which behind a proxy is not the same.
    pub fn redirect_url(&self) -> String {
        format!("{}{}/result/callback", self.public_url, self.base_path)
    }
}

fn sdk_origin(sdk_url: &str) -> Result<String> {
    let parsed = Url::parse(sdk_url).map_err(|_| format!("SDK_URL is not a URL: {sdk_url}"))?;
    match parsed.host_str() {
        Some(host) => Ok(match parsed.port() {
            Some(port) => format!("{}://{host}:{port}", parsed.scheme()),
            None => format!("{}://{host}", parsed.scheme()),
        }),
        None => Err(format!("SDK_URL has no host: {sdk_url}").into()),
    }
}

/// The key comes from a file on a server, or inline for local runs.
fn read_private_key(env: &Env) -> Result<RsaPrivateKey> {
    let path = env.get("PRIVATE_KEY_PATH", "");
    let pem = if path.is_empty() {
        env.get("PRIVATE_KEY", "")
    } else {
        fs::read_to_string(&path).map_err(|err| format!("{path}: {err}"))?
    };
    if pem.is_empty() {
        return Err("set PRIVATE_KEY_PATH or PRIVATE_KEY, see .env.example".into());
    }
    parse_private_key(&pem)
}

/// Accepts a PKCS#8 or PKCS#1 PEM, with real newlines or with escaped `\n`, so the key can also
/// live on a single line in an environment variable.
fn parse_private_key(text: &str) -> Result<RsaPrivateKey> {
    let pem = text.replace("\\n", "\n");
    RsaPrivateKey::from_pkcs8_pem(&pem)
        .or_else(|_| RsaPrivateKey::from_pkcs1_pem(&pem))
        .map_err(|_| "the private key is not a valid PKCS#8 or PKCS#1 RSA PEM block".into())
}

/// The process environment, with a `.env` file behind it.
///
/// The file is read into a map rather than into the environment: a variable that is already set
/// wins, so the shell — and the end-to-end suite, which passes every setting that way — can
/// override the file without the file ever being written to.
struct Env {
    file: HashMap<String, String>,
}

impl Env {
    fn load(path: &str) -> Result<Env> {
        let text = match fs::read_to_string(path) {
            Ok(text) => text,
            Err(err) if err.kind() == ErrorKind::NotFound => String::new(),
            Err(err) => return Err(format!("{path}: {err}").into()),
        };

        let mut file = HashMap::new();
        for line in text.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            let Some((name, value)) = line.split_once('=') else {
                continue;
            };
            file.insert(
                name.trim().to_owned(),
                value.trim().trim_matches(['"', '\'']).to_owned(),
            );
        }
        Ok(Env { file })
    }

    /// An empty value counts as unset, in the environment and in the file alike.
    fn get(&self, name: &str, fallback: &str) -> String {
        std::env::var(name)
            .ok()
            .filter(|value| !value.is_empty())
            .or_else(|| {
                self.file
                    .get(name)
                    .filter(|value| !value.is_empty())
                    .cloned()
            })
            .unwrap_or_else(|| fallback.to_owned())
    }
}
