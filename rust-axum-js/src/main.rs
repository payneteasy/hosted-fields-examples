//! Routes under `BASE_PATH`, and the generated `config.js`.

mod config;
mod control;
mod oauth;
mod paynet;

use std::collections::BTreeMap;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use axum::body::{Body, Bytes};
use axum::extract::{ConnectInfo, RawQuery, State};
use axum::http::{HeaderMap, HeaderValue, Method, StatusCode, header};
use axum::response::{IntoResponse, Redirect, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use include_dir::{Dir, include_dir};
use serde::Deserialize;
use serde_json::json;

use crate::config::Config;
use crate::paynet::Customer;

pub type Error = Box<dyn std::error::Error + Send + Sync>;
pub type Result<T> = std::result::Result<T, Error>;

/// Form or query parameters. Sorted, and the first value of a repeated name wins — the same
/// reading on the callback body and on the `/result` query, so the four values that are verified
/// are the four that are forwarded.
pub type Params = BTreeMap<String, String>;

/// The pages and the client scripts, compiled in: the artefact is one binary with no files beside
/// it, and there is nothing to edit on a server. Both directories are copies of `shared/` — edit
/// it there and run `scripts/sync-shared.sh`.
static VIEWS: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/views");
static PUBLIC: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/public");

#[derive(Clone)]
pub struct AppState {
    pub config: Arc<Config>,
    pub http: reqwest::Client,
}

#[tokio::main]
async fn main() -> Result<()> {
    // rustls with the ring provider, rather than the aws-lc-rs one, which wants cmake to build
    rustls::crypto::ring::default_provider()
        .install_default()
        .map_err(|_| "could not install the rustls crypto provider")?;

    // Everything is read and validated here, before the server is built: the process must refuse
    // to start without credentials rather than serve a payment page that cannot take a payment.
    let config = Arc::new(Config::load(".env")?);
    let state = AppState {
        http: reqwest::Client::builder()
            // reqwest has no default timeout at all, so a gateway that stops answering would
            // otherwise hold the request — and the payer — forever
            .timeout(Duration::from_secs(10))
            .build()?,
        config: Arc::clone(&config),
    };

    let address = format!("{}:{}", config.listen_addr, config.port);
    let listener = tokio::net::TcpListener::bind(&address).await?;
    println!("listening on http://{address}{}/", config.base_path);

    let app = router(state);
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await?;
    Ok(())
}

/// Every route lives under `BASE_PATH`, so several examples fit behind one nginx.
fn router(state: AppState) -> Router {
    let base = state.config.base_path.clone();

    // The two pages are static files: the only thing this server generates is window.CONFIG, and
    // it hands that over as a script of its own. That is what lets views/ be identical whatever
    // language the example is written in.
    let mounted = Router::new()
        .route("/config.js", get(config_js))
        .route("/result-config.js", get(result_config_js))
        .route("/pay", post(pay))
        .route("/status", get(status))
        // The gateway returns the payer from a 3DS challenge with a POST, not a GET, so the
        // callback and the page it sends them to are separate routes.
        .route(
            "/result/callback",
            get(result_callback).post(result_callback),
        )
        .route("/result", get(result))
        // Stylesheet and client scripts, from an allowlist
        .route("/{asset}", get(asset));

    // `nest` maps the mounted router's "/" onto the *bare* prefix, so the payment page cannot be
    // registered inside it: the page has to live at the trailing-slash form, which is the one its
    // relative asset URLs resolve against. The bare prefix redirects there instead.
    Router::new()
        .route(&base, get(redirect_to_slash))
        .route(&format!("{base}/"), get(checkout))
        .nest(&base, mounted)
        .with_state(state)
}

/// The prefix without its trailing slash, which the views' relative asset URLs would resolve
/// against the parent path. nginx sends the same 301 in front of this.
async fn redirect_to_slash(State(state): State<AppState>) -> Response {
    let target = format!("{}/", state.config.base_path);
    match HeaderValue::from_str(&target) {
        Ok(target) => (StatusCode::MOVED_PERMANENTLY, [(header::LOCATION, target)]).into_response(),
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "bad base path").into_response(),
    }
}

async fn checkout(State(state): State<AppState>) -> Response {
    view(&state.config, "checkout.html")
}

/// Step 1. A fresh single-use ticket for every page load, handed to the page as a script.
async fn config_js(State(state): State<AppState>) -> Response {
    let config = &state.config;
    let mut window_config = BTreeMap::from([
        ("basePath", config.base_path.clone()),
        ("sdkUrl", config.sdk_url.clone()),
        ("endpointId", config.endpoint_id.clone()),
        // The page shows what the server will actually charge
        ("amount", config.order_amount.clone()),
        ("currency", config.order_currency.clone()),
    ]);

    match paynet::ephemeral_ticket(&state).await {
        Ok(ticket) => {
            window_config.insert("ephemeralTicket", ticket);
        }
        Err(err) => {
            // This has to stay valid JavaScript whatever happened upstream, or the page cannot
            // even tell the payer that it did. checkout.js reads the absent ticket as terminal.
            eprintln!("[error] {err}");
            window_config.insert("error", err.to_string());
        }
    }

    write_config_js(&window_config)
}

/// The 3DS return page needs no ticket: there is no card on it to tokenize.
async fn result_config_js(State(state): State<AppState>) -> Response {
    let config = &state.config;
    write_config_js(&BTreeMap::from([
        ("basePath", config.base_path.clone()),
        ("amount", config.order_amount.clone()),
        ("currency", config.order_currency.clone()),
    ]))
}

#[derive(Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct Payment {
    hosted_fields_token: String,
    browser: Params,
    customer: Customer,
}

/// Step 3. The browser has exchanged the card for a token; start the payment.
async fn pay(
    State(state): State<AppState>,
    headers: HeaderMap,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    body: String,
) -> Response {
    let Ok(payment) = serde_json::from_str::<Payment>(&body) else {
        return error_json(StatusCode::BAD_REQUEST, "malformed request body");
    };
    if payment.hosted_fields_token.is_empty() {
        return error_json(StatusCode::BAD_REQUEST, "hostedFieldsToken is required");
    }

    let browser = browser_params(&payment.browser, &headers);
    let client_order_id = match new_client_order_id() {
        Ok(id) => id,
        Err(err) => return fail(&err),
    };

    let sale = paynet::create_sale(
        &state,
        &payment.hosted_fields_token,
        &client_order_id,
        &client_ip(&headers, peer),
        &browser,
        &payment.customer,
    )
    .await;

    match sale {
        Ok(mut sale) => {
            sale.insert("clientOrderId".to_owned(), client_order_id.into());
            (StatusCode::OK, Json(sale)).into_response()
        }
        Err(err) => fail(&err),
    }
}

/// The merchant's own identifier for the order. It is random rather than sequential or
/// clock-based: the page hands it back on every /status poll, so an id that can be guessed would
/// make somebody else's order readable — and two payers in the same millisecond would have
/// collided.
fn new_client_order_id() -> Result<String> {
    let mut id = [0u8; 16];
    getrandom::fill(&mut id)?;
    Ok(format!("hf-{}", hex::encode(id)))
}

/// The 3DS 2.0 values the page is allowed to supply. Everything else the Sale needs — amount,
/// currency, redirect_url, hosted_fields_token, client_orderid — belongs to the server, so the
/// request body is filtered here rather than merged: a body naming "amount" would otherwise have
/// chosen what the payer is charged.
const BROWSER_FIELDS: [&str; 8] = [
    "customer_browser_info",
    "customer_browser_javascript_enabled",
    "customer_browser_java_enabled",
    "customer_browser_accept_language",
    "customer_browser_color_depth",
    "customer_browser_screen_width",
    "customer_browser_screen_height",
    "customer_browser_time_zone",
];

/// Keeps the allowed fields and drops everything else. The last two come from the request
/// headers, never from the body, so the caller cannot spoof them.
fn browser_params(src: &Params, headers: &HeaderMap) -> Params {
    let mut browser = Params::new();
    for name in BROWSER_FIELDS {
        if let Some(value) = src.get(name) {
            browser.insert(name.to_owned(), value.clone());
        }
    }
    browser.insert(
        "customer_browser_accept_header".to_owned(),
        header(headers, header::ACCEPT, "*/*"),
    );
    browser.insert(
        "customer_browser_user_agent".to_owned(),
        header(headers, header::USER_AGENT, ""),
    );
    browser
}

/// Step 4. The page polls this until the order reaches a final status.
async fn status(State(state): State<AppState>, RawQuery(query): RawQuery) -> Response {
    let query = form_params(query.as_deref().unwrap_or_default());
    let (Some(order_id), Some(client_order_id)) =
        (query.get("orderId"), query.get("clientOrderId"))
    else {
        return error_json(
            StatusCode::BAD_REQUEST,
            "orderId and clientOrderId are required",
        );
    };

    match paynet::order_status(&state, order_id, client_order_id).await {
        Ok(status) => ([(header::CACHE_CONTROL, "no-store")], Json(status)).into_response(),
        Err(err) => fail(&err),
    }
}

/// The parameters the gateway signs its callback with, in the order the page wants them back.
const SIGNED_CALLBACK_FIELDS: [&str; 4] = ["status", "orderid", "merchant_order", "control"];

/// Step 5. Where the gateway returns the payer after a 3DS challenge, with a POST. It is not a
/// page, because a page cannot be delivered by POST and still be reloadable: the signature is
/// checked here and the payer is sent on to /result with the same signed parameters in the query.
/// The browser carries them, but it cannot forge them — it does not know MERCHANT_CONTROL — and
/// /result checks them again before it serves anything.
async fn result_callback(State(state): State<AppState>, method: Method, body: String) -> Response {
    // The body, never the query: the four values that are verified have to be the four that are
    // forwarded. A GET here is nobody arriving from a payment, and sends them to the empty page.
    let form = form_params(&body);
    if method == Method::POST && !control::valid_callback(&form, &state.config.merchant_control) {
        let order = form.get("orderid").map_or("", String::as_str);
        eprintln!("[error] callback signature mismatch for order {order:?}");
        return (StatusCode::FORBIDDEN, "invalid callback signature").into_response();
    }

    // Built by hand rather than by a serializer, which would sort: every example puts these in the
    // same order, so the URL the payer ends up on is the same one everywhere.
    let mut signed = form_urlencoded::Serializer::new(String::new());
    let mut any = false;
    for name in SIGNED_CALLBACK_FIELDS {
        if let Some(value) = form.get(name).filter(|value| !value.is_empty()) {
            signed.append_pair(name, value);
            any = true;
        }
    }

    let mut target = format!("{}/result", state.config.base_path);
    if any {
        target += &format!("?{}", signed.finish());
    }
    // 303, so the browser follows with a GET whatever it arrived with, and to a relative Location,
    // so a TLS-terminating proxy cannot turn the 3DS return into an http:// redirect
    Redirect::to(&target).into_response()
}

/// The 3DS return page. The callback carries the outcome too, but the documentation says not to
/// treat it as the status — the page looks the order up over the API instead.
async fn result(State(state): State<AppState>, RawQuery(query): RawQuery) -> Response {
    // The query is only there when the payer came through the callback. Rechecking it here is what
    // stops a hand-edited URL: without it the page would happily poll somebody else's order. No
    // query at all is fine — the page then says there is nothing to show.
    let query = form_params(query.as_deref().unwrap_or_default());
    if let Some(order) = query.get("orderid").filter(|order| !order.is_empty())
        && !control::valid_callback(&query, &state.config.merchant_control)
    {
        eprintln!("[error] result signature mismatch for order {order:?}");
        return (StatusCode::FORBIDDEN, "invalid result signature").into_response();
    }

    view(&state.config, "result.html")
}

/// The stylesheet and the client scripts, from an allowlist rather than from whatever happens to
/// be in the directory.
async fn asset(axum::extract::Path(name): axum::extract::Path<String>) -> Response {
    let content_type = match name.as_str() {
        "styles.css" => "text/css; charset=utf-8",
        "checkout.js" | "status.js" | "result.js" => "text/javascript; charset=utf-8",
        _ => return (StatusCode::NOT_FOUND, "not found").into_response(),
    };
    let Some(file) = PUBLIC.get_file(&name) else {
        return (StatusCode::NOT_FOUND, "not found").into_response();
    };

    (
        [(header::CONTENT_TYPE, content_type)],
        Bytes::from_static(file.contents()),
    )
        .into_response()
}

/// Both pages are served straight out of the compiled-in files, with nothing substituted into
/// them.
fn view(config: &Config, name: &str) -> Response {
    let Some(page) = VIEWS.get_file(name) else {
        eprintln!("[error] {name} is missing from the compiled-in views");
        return (StatusCode::INTERNAL_SERVER_ERROR, "page not found").into_response();
    };

    let mut response = Response::new(Body::from(Bytes::from_static(page.contents())));
    security_headers(config, response.headers_mut());
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/html; charset=utf-8"),
    );
    response
}

/// What a payment page ought to send. The policy is worth reading as part of the example: the card
/// fields are iframes from the gateway, so the SDK host has to be named in frame-src as well as in
/// script-src, and everything else is denied by default.
///
/// No 'unsafe-inline' anywhere, which is why the result page's script lives in public/result.js
/// rather than in the markup: nothing in views/ is templated, so there is nowhere to put a nonce.
fn security_headers(config: &Config, headers: &mut HeaderMap) {
    let sdk = &config.sdk_origin;
    let policy = [
        "default-src 'none'".to_owned(),
        format!("script-src 'self' {sdk}"),
        "style-src 'self'".to_owned(),
        // The three card inputs are cross-origin iframes served by the gateway
        format!("frame-src {sdk}"),
        format!("connect-src 'self' {sdk}"),
        "img-src 'self' data:".to_owned(),
        "base-uri 'none'".to_owned(),
        "form-action 'self'".to_owned(),
        "frame-ancestors 'none'".to_owned(),
    ]
    .join("; ");

    if let Ok(policy) = HeaderValue::from_str(&policy) {
        headers.insert(header::CONTENT_SECURITY_POLICY, policy);
    }
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("no-referrer"),
    );
    // The page carries the signed order parameters in its URL, and it is one payment's page
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
}

/// window.CONFIG as a script of its own: the only thing this server generates.
fn write_config_js(window_config: &BTreeMap<&str, String>) -> Response {
    let body = format!(
        "window.CONFIG = {};\n",
        serde_json::to_string(window_config).unwrap_or_else(|_| "{}".to_owned())
    );

    (
        [
            (header::CONTENT_TYPE, "text/javascript; charset=utf-8"),
            // The ticket inside is single-use, so this must never come from a cache
            (header::CACHE_CONTROL, "no-store"),
        ],
        body,
    )
        .into_response()
}

/// Any gateway failure surfaces to the page as one 502 with a message.
fn fail(err: &Error) -> Response {
    eprintln!("[error] {err}");
    error_json(StatusCode::BAD_GATEWAY, &err.to_string())
}

fn error_json(status: StatusCode, message: &str) -> Response {
    (status, Json(json!({ "error": message }))).into_response()
}

/// Form or query parameters, with the first value of a repeated name winning.
fn form_params(body: &str) -> Params {
    let mut params = Params::new();
    for (name, value) in form_urlencoded::parse(body.as_bytes()) {
        params
            .entry(name.into_owned())
            .or_insert_with(|| value.into_owned());
    }
    params
}

/// The payer's address, which the platform uses for fraud screening.
///
/// Behind nginx it only arrives in X-Forwarded-For, so the proxy must set it. nginx *appends* the
/// address it saw to whatever the caller sent, so the last element is the one our own proxy wrote
/// and everything before it is the caller's hearsay — which is why this reads the last one and not
/// the first. Exposed straight to the internet, with nothing appending anything, the header would
/// still be a caller's to choose: that is one of the reasons the app binds to loopback by default.
fn client_ip(headers: &HeaderMap, peer: SocketAddr) -> String {
    let forwarded = header(headers, "X-Forwarded-For", "");
    let ip = forwarded
        .rsplit(',')
        .next()
        .map(str::trim)
        .filter(|ip| !ip.is_empty())
        .map_or_else(|| peer.ip().to_string(), str::to_owned);

    if ip == "::1" {
        return "127.0.0.1".to_owned();
    }
    ip.strip_prefix("::ffff:").unwrap_or(&ip).to_owned()
}

fn header(
    headers: &HeaderMap,
    name: impl axum::http::header::AsHeaderName,
    fallback: &str,
) -> String {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.is_empty())
        .unwrap_or(fallback)
        .to_owned()
}
