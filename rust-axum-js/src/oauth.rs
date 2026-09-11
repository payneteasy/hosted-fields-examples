//! OAuth 1.0a RSA-SHA256 request signing.
//! <https://doc.payneteasy.com/integration/general_api_usage/request_authentication_methods/oauth.html>

use std::collections::BTreeMap;
use std::fmt::Write as _;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as BASE64;
use rsa::Pkcs1v15Sign;
use sha2::{Digest as _, Sha256};

use crate::Result;
use crate::config::Config;

/// Builds the `Authorization` header for a signed API call. `params` are the
/// x-www-form-urlencoded parameters of the request, if any.
pub fn auth_header(
    config: &Config,
    method: &str,
    endpoint: &str,
    params: &BTreeMap<String, String>,
) -> Result<String> {
    let mut nonce = [0u8; 16];
    getrandom::fill(&mut nonce)?;
    let timestamp = SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs();

    let mut oauth = BTreeMap::from([
        (
            "oauth_consumer_key".to_owned(),
            config.merchant_login.clone(),
        ),
        ("oauth_nonce".to_owned(), hex::encode(nonce)),
        ("oauth_signature_method".to_owned(), "RSA-SHA256".to_owned()),
        ("oauth_timestamp".to_owned(), timestamp.to_string()),
        ("oauth_version".to_owned(), "1.0".to_owned()),
    ]);

    // Signature base string: METHOD&url&sorted-parameters, each part percent-encoded
    let mut signed = params.clone();
    signed.extend(
        oauth
            .iter()
            .map(|(key, value)| (key.clone(), value.clone())),
    );
    let base_string = format!(
        "{}&{}&{}",
        method.to_uppercase(),
        encode(endpoint),
        encode(&normalize(&signed))
    );

    let digest = Sha256::digest(base_string.as_bytes());
    let signature = config
        .private_key
        .sign(Pkcs1v15Sign::new::<Sha256>(), &digest)?;
    oauth.insert("oauth_signature".to_owned(), BASE64.encode(signature));

    // Header values are not encoded by the transport, so encode them here
    let pairs: Vec<String> = oauth
        .iter()
        .map(|(key, value)| format!("{key}=\"{}\"", encode(value)))
        .collect();
    Ok(format!("OAuth {}", pairs.join(", ")))
}

/// The parameters of the base string: sorted by name, each part percent-encoded.
/// A `BTreeMap` is already in the order OAuth wants.
pub fn normalize(params: &BTreeMap<String, String>) -> String {
    params
        .iter()
        .map(|(key, value)| format!("{}={}", encode(key), encode(value)))
        .collect::<Vec<_>>()
        .join("&")
}

/// RFC 3986 percent encoding.
///
/// Not `form_urlencoded`, and not any other form encoder: those write a space as `+` and leave
/// `!'()*` alone, and either one produces a signature the gateway rejects. The request *body*
/// really is form encoded — that is the one place the other encoder belongs.
pub fn encode(value: &str) -> String {
    const UNRESERVED: &[u8] = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~";

    let mut out = String::with_capacity(value.len());
    for byte in value.bytes() {
        if UNRESERVED.contains(&byte) {
            out.push(byte as char);
        } else {
            let _ = write!(out, "%{byte:02X}");
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    // The signature base string is where OAuth quietly breaks: every part has to be
    // percent-encoded to RFC 3986, and a form encoder is not. A wrong byte here is a 401 from the
    // gateway with nothing in the log to say why, so these are the vectors that pin it down.

    #[test]
    fn encode_is_rfc3986() {
        let cases = [
            // The five characters a form encoder leaves alone and OAuth does not
            ("!'()*", "%21%27%28%29%2A"),
            // A space is %20, never +
            ("John Smith", "John%20Smith"),
            // + is a literal plus, and must not survive as one
            ("a+b", "a%2Bb"),
            // Unreserved characters are left exactly as they are
            ("abcXYZ019-._~", "abcXYZ019-._~"),
            // Non-ASCII is encoded per UTF-8 byte
            ("é", "%C3%A9"),
        ];
        for (input, want) in cases {
            assert_eq!(encode(input), want, "encode({input:?})");
        }
    }

    fn sample_params() -> BTreeMap<String, String> {
        BTreeMap::from([
            ("oauth_consumer_key".to_owned(), "merchant".to_owned()),
            ("amount".to_owned(), "1.00".to_owned()),
            ("client_orderid".to_owned(), "hf-1".to_owned()),
        ])
    }

    #[test]
    fn normalize_sorts_by_key() {
        assert_eq!(
            normalize(&sample_params()),
            "amount=1.00&client_orderid=hf-1&oauth_consumer_key=merchant"
        );
    }

    /// The same vector as the Go and Express examples, so the signatures cannot drift apart.
    #[test]
    fn base_string_matches_the_other_examples() {
        let endpoint = "https://gateway.example/paynet/api/v4/sale/123";
        let got = format!(
            "POST&{}&{}",
            encode(endpoint),
            encode(&normalize(&sample_params()))
        );

        assert_eq!(
            got,
            "POST&https%3A%2F%2Fgateway.example%2Fpaynet%2Fapi%2Fv4%2Fsale%2F123&\
             amount%3D1.00%26client_orderid%3Dhf-1%26oauth_consumer_key%3Dmerchant"
        );
    }
}
