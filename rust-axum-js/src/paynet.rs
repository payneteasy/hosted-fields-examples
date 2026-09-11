//! The three gateway calls the Hosted Fields flow needs.
//! <https://doc.payneteasy.com/integration/api_use_cases/hosted_fields.html>

use serde::Deserialize;
use serde_json::Value;

use crate::oauth;
use crate::{AppState, Params, Result};

/// A decoded gateway reply. Keys are the documented kebab-case names; values are mostly strings,
/// but not always — `error-code` is a number in a sale response.
pub type Reply = serde_json::Map<String, Value>;

/// Returns a single-use ticket the browser exchanges for a hosted fields token. It is valid for
/// 15 minutes and safe to put on the page.
pub async fn ephemeral_ticket(state: &AppState) -> Result<String> {
    let decoded = post_json(
        state,
        "/api/v4/tokenize/create-ephemeral-ticket/",
        Params::new(),
    )
    .await?;

    let ticket = decoded
        .get("ephemeralTicket")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    if !ticket.is_empty() {
        return Ok(ticket.to_owned());
    }

    // A rejected request comes back as 4xx with a JSON body carrying the reason. Only that one
    // field is quoted: this reason travels on into config.js, where the browser can read it, and
    // the rest of the reply is the gateway's business and not the payer's.
    match decoded.get("error-message").and_then(Value::as_str) {
        Some(message) if !message.is_empty() => {
            Err(format!("no ephemeralTicket: {message}").into())
        }
        _ => Err("no ephemeralTicket in the response".into()),
    }
}

/// Payer details collected by our own inputs, next to the card iframes.
#[derive(Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Customer {
    pub first_name: String,
    pub last_name: String,
    pub email: String,
    /// The card holder name, composed by the page from the two above: the hosted fields token
    /// does not carry it, and with the token the platform leaves the holder empty unless it is
    /// sent here — which some acquirers do not survive.
    pub card_printed_name: String,
}

/// Charges the card behind the hosted fields token. The token replaces `credit_card_number`,
/// `expire_month`, `expire_year` and `cvv2` — sending those is an error.
pub async fn create_sale(
    state: &AppState,
    hosted_fields_token: &str,
    client_order_id: &str,
    ip_address: &str,
    browser: &Params,
    payer: &Customer,
) -> Result<Reply> {
    let config = &state.config;
    let mut params = Params::from([
        ("client_orderid".to_owned(), client_order_id.to_owned()),
        (
            "order_desc".to_owned(),
            "Hosted Fields example order".to_owned(),
        ),
        ("amount".to_owned(), config.order_amount.clone()),
        ("currency".to_owned(), config.order_currency.clone()),
        (
            "hosted_fields_token".to_owned(),
            hosted_fields_token.to_owned(),
        ),
        (
            "card_printed_name".to_owned(),
            payer.card_printed_name.clone(),
        ),
        ("first_name".to_owned(), payer.first_name.clone()),
        ("last_name".to_owned(), payer.last_name.clone()),
        ("address1".to_owned(), "100 Main st".to_owned()),
        ("city".to_owned(), "Seattle".to_owned()),
        ("zip_code".to_owned(), "98102".to_owned()),
        ("country".to_owned(), "US".to_owned()),
        ("state".to_owned(), "WA".to_owned()),
        ("phone".to_owned(), "+12063582043".to_owned()),
        ("email".to_owned(), payer.email.clone()),
        ("ipaddress".to_owned(), ip_address.to_owned()),
        ("redirect_url".to_owned(), config.redirect_url()),
    ]);

    // 3DS 2.0 browser data, required by /api/v4/sale. It comes from the page, so a parameter the
    // server has already set is never taken from it: the /pay handler filters the body to the
    // documented keys and this loop refuses to overwrite, so neither guard is load-bearing alone.
    for (key, value) in browser {
        params.entry(key.clone()).or_insert_with(|| value.clone());
    }

    post_json(state, "/api/v4/sale/", params).await
}

/// Polled until the order reaches a final status.
pub async fn order_status(
    state: &AppState,
    order_id: &str,
    client_order_id: &str,
) -> Result<Reply> {
    let params = Params::from([
        ("login".to_owned(), state.config.merchant_login.clone()),
        ("client_orderid".to_owned(), client_order_id.to_owned()),
        ("orderid".to_owned(), order_id.to_owned()),
    ]);
    post_json(state, "/api/v4/status/", params).await
}

/// Sends a signed command and decodes the reply. A rejected request — a validation error, or a
/// decline — comes back as 4xx with a JSON body, so the body is decoded whatever the status: it
/// carries the `error-message` for the page. Only a reply that is not JSON at all counts as a
/// failure of the call itself.
async fn post_json(state: &AppState, command: &str, params: Params) -> Result<Reply> {
    let (body, status) = post(state, command, &params).await?;

    // The body is not quoted: it reaches the page as {error}. The log line above has the detail.
    serde_json::from_str(&body).map_err(|_| format!("gateway request failed with {status}").into())
}

async fn post(state: &AppState, command: &str, params: &Params) -> Result<(String, u16)> {
    let config = &state.config;
    let endpoint = format!("{}{command}{}", config.api_url, config.endpoint_id);
    let authorization = oauth::auth_header(config, "POST", &endpoint, params)?;

    let result = state
        .http
        .post(&endpoint)
        // Ask for JSON instead of the default x-www-form-urlencoded reply.
        // https://doc.payneteasy.com/integration/openapi.html
        .header("Accept", "application/vnd.pay+json")
        .header("Authorization", authorization)
        // Sets Content-Type: application/x-www-form-urlencoded. This is the form encoding the
        // signature encoder in oauth.rs must not be confused with: here it is the right one.
        .form(params)
        .send()
        .await?;

    let status = result.status().as_u16();
    let body = result.text().await?;
    println!("[paynet] POST {endpoint} -> {status}{}", log_reason(&body));
    Ok((body, status))
}

/// What goes in the log beside the status code. Not the body: a status reply carries the card's
/// last four digits and the holder's name, and the ticket reply carries the ticket. The gateway
/// puts everything a log needs to be useful into these two fields anyway.
///
/// It reads a loose `Value` rather than a typed struct. The gateway answers `paynet-order-id` as a
/// number in a sale reply and as a string elsewhere, and a struct field would turn that difference
/// into "reply is not JSON" on a perfectly good answer.
fn log_reason(body: &str) -> String {
    let Ok(decoded) = serde_json::from_str::<Value>(body) else {
        return " (reply is not JSON)".to_owned();
    };

    let mut reason = String::new();
    let id = log_field(&decoded, "paynet-order-id");
    if !id.is_empty() {
        reason += &format!(" order {id}");
    }
    let message = log_field(&decoded, "error-message");
    if !message.is_empty() {
        reason += &format!(" {message}");
    }
    reason
}

/// Renders one value of a decoded reply as text, whatever JSON type it arrived as, on one line.
fn log_field(decoded: &Value, name: &str) -> String {
    let text = match decoded.get(name) {
        None | Some(Value::Null) => return String::new(),
        Some(Value::String(value)) => value.clone(),
        Some(value) => value.to_string(),
    };
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    // The gateway is not consistent about the JSON type of paynet-order-id — a sale reply answers
    // with a number, other calls with a string — so the log line has to survive both. In the Go
    // example this once decoded into a typed struct, which reported a perfectly good sale reply
    // as "reply is not JSON".
    #[test]
    fn log_reason_survives_every_shape() {
        let cases = [
            (
                "sale reply, order id as a number",
                r#"{"type":"async-form-response","paynet-order-id":12345,"merchant-order-id":"hf-abc"}"#,
                " order 12345",
            ),
            (
                "order id as a string",
                r#"{"paynet-order-id":"12345","merchant-order-id":"hf-abc"}"#,
                " order 12345",
            ),
            (
                "a long order id keeps its digits, rather than turning into 1.2345678901e+10",
                r#"{"paynet-order-id":12345678901}"#,
                " order 12345678901",
            ),
            (
                "a decline carries the reason as well",
                r#"{"paynet-order-id":12345,"error-message":"Declined by the issuer","error-code":3}"#,
                " order 12345 Declined by the issuer",
            ),
            (
                "a message spread over lines is flattened",
                r#"{"error-message":"Declined\n  by the issuer"}"#,
                " Declined by the issuer",
            ),
            (
                "nothing worth logging",
                r#"{"type":"async-form-response"}"#,
                "",
            ),
            (
                "a reply that really is not JSON says so",
                "type=async-form-response\npaynet-order-id=12345",
                " (reply is not JSON)",
            ),
        ];

        for (name, body, want) in cases {
            assert_eq!(log_reason(body), want, "{name}");
        }
    }

    /// The body itself must never reach the log: a status reply carries the card and the holder,
    /// and the ticket reply carries the ticket.
    #[test]
    fn log_reason_keeps_the_body_out() {
        let body = r#"{"paynet-order-id":12345,"card-printed-name":"JOHN SMITH",
                       "last-four-digits":"4448","ephemeralTicket":"secret-ticket"}"#;
        let got = log_reason(body);
        for secret in ["JOHN SMITH", "4448", "secret-ticket"] {
            assert!(
                !got.contains(secret),
                "log_reason leaked {secret:?} in {got:?}"
            );
        }
    }
}
