package main

import (
	"crypto/rand"
	"crypto/sha1"
	"crypto/subtle"
	"embed"
	"encoding/hex"
	"encoding/json"
	"io/fs"
	"log"
	"net"
	"net/http"
	"net/url"
	"strings"
)

//go:embed views public
var assets embed.FS

func main() {
	var err error
	if cfg, err = loadConfig(".env"); err != nil {
		log.Fatal(err)
	}

	public, err := fs.Sub(assets, "public")
	if err != nil {
		log.Fatal(err)
	}

	// Every route lives under BASE_PATH, so several examples fit behind one nginx.
	mux := http.NewServeMux()
	// The two pages are static files: the only thing this server generates is window.CONFIG,
	// and it hands that over as a script of its own. That is what lets views/ be identical
	// whatever language the example is written in.
	mux.HandleFunc("GET "+cfg.BasePath+"/{$}", handleCheckout)
	mux.HandleFunc("GET "+cfg.BasePath+"/config.js", handleConfigJS)
	mux.HandleFunc("GET "+cfg.BasePath+"/result-config.js", handleResultConfigJS)
	mux.HandleFunc("POST "+cfg.BasePath+"/pay", handlePay)
	mux.HandleFunc("GET "+cfg.BasePath+"/status", handleStatus)
	// The gateway returns the payer from a 3DS challenge with a POST, not a GET, so the
	// callback and the page it sends them to are separate routes.
	mux.HandleFunc("POST "+cfg.BasePath+"/result/callback", handleResultCallback)
	mux.HandleFunc("GET "+cfg.BasePath+"/result/callback", handleResultCallback)
	mux.HandleFunc("GET "+cfg.BasePath+"/result", handleResult)
	// Stylesheet and client scripts. Registering the subtree also makes the mux
	// redirect a request for the bare prefix to the trailing-slash form, which
	// keeps the relative asset URLs on the payment page working.
	mux.Handle("GET "+cfg.BasePath+"/", http.StripPrefix(cfg.BasePath+"/", http.FileServerFS(public)))

	address := net.JoinHostPort(cfg.ListenAddr, cfg.Port)
	log.Printf("listening on http://%s%s/", address, cfg.BasePath)
	log.Fatal(http.ListenAndServe(address, mux))
}

func handleCheckout(w http.ResponseWriter, r *http.Request) { serveView(w, "checkout.html") }

// Step 1. A fresh single-use ticket for every page load, handed to the page as a script.
func handleConfigJS(w http.ResponseWriter, r *http.Request) {
	config := map[string]string{
		"basePath":   cfg.BasePath,
		"sdkUrl":     cfg.SDKURL,
		"endpointId": cfg.EndpointID,
		// The page shows what the server will actually charge
		"amount":   cfg.OrderAmount,
		"currency": cfg.OrderCurrency,
	}

	if ticket, err := getEphemeralTicket(); err == nil {
		config["ephemeralTicket"] = ticket
	} else {
		// This has to stay valid JavaScript whatever happened upstream, or the page cannot
		// even tell the payer that it did. checkout.js reads the absent ticket as terminal.
		log.Printf("[error] %v", err)
		config["error"] = err.Error()
	}

	writeConfigJS(w, config)
}

// The 3DS return page needs no ticket: there is no card on it to tokenize.
func handleResultConfigJS(w http.ResponseWriter, r *http.Request) {
	writeConfigJS(w, map[string]string{
		"basePath": cfg.BasePath,
		"amount":   cfg.OrderAmount,
		"currency": cfg.OrderCurrency,
	})
}

// Step 3. The browser has exchanged the card for a token; start the payment.
func handlePay(w http.ResponseWriter, r *http.Request) {
	var payment struct {
		HostedFieldsToken string            `json:"hostedFieldsToken"`
		Browser           map[string]string `json:"browser"`
		Customer          customer          `json:"customer"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payment); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "malformed request body"})
		return
	}
	if payment.HostedFieldsToken == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "hostedFieldsToken is required"})
		return
	}

	browser := browserParams(payment.Browser, r)

	clientOrderID, err := newClientOrderID()
	if err != nil {
		fail(w, err)
		return
	}

	sale, err := createSale(payment.HostedFieldsToken, clientOrderID, clientIP(r), browser, payment.Customer)
	if err != nil {
		fail(w, err)
		return
	}

	sale["clientOrderId"] = clientOrderID
	writeJSON(w, http.StatusOK, sale)
}

// newClientOrderID is the merchant's own identifier for the order. It is random rather than
// sequential or clock-based: the page hands it back on every /status poll, so an id that can be
// guessed would make somebody else's order readable — and two payers in the same millisecond
// would have collided.
func newClientOrderID() (string, error) {
	id := make([]byte, 16)
	if _, err := rand.Read(id); err != nil {
		return "", err
	}
	return "hf-" + hex.EncodeToString(id), nil
}

// browserFields are the 3DS 2.0 values the page is allowed to supply. Everything else the Sale
// needs — amount, currency, redirect_url, hosted_fields_token, client_orderid — belongs to the
// server, so the request body is filtered here rather than merged: a body naming "amount" would
// otherwise have chosen what the payer is charged.
var browserFields = []string{
	"customer_browser_info",
	"customer_browser_javascript_enabled",
	"customer_browser_java_enabled",
	"customer_browser_accept_language",
	"customer_browser_color_depth",
	"customer_browser_screen_width",
	"customer_browser_screen_height",
	"customer_browser_time_zone",
}

// browserParams keeps the allowed fields and drops everything else. The last two come from the
// request headers, never from the body, so the caller cannot spoof them.
func browserParams(src map[string]string, r *http.Request) url.Values {
	browser := url.Values{}
	for _, name := range browserFields {
		if value, ok := src[name]; ok {
			browser.Set(name, value)
		}
	}
	browser.Set("customer_browser_accept_header", header(r, "Accept", "*/*"))
	browser.Set("customer_browser_user_agent", header(r, "User-Agent", ""))
	return browser
}

// Step 4. The page polls this until the order reaches a final status.
func handleStatus(w http.ResponseWriter, r *http.Request) {
	orderID := r.URL.Query().Get("orderId")
	clientOrderID := r.URL.Query().Get("clientOrderId")
	if orderID == "" || clientOrderID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "orderId and clientOrderId are required"})
		return
	}

	status, err := getStatus(orderID, clientOrderID)
	if err != nil {
		fail(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, status)
}

// The parameters the gateway signs its callback with, in the order the page wants them back.
var signedCallbackFields = []string{"status", "orderid", "merchant_order", "control"}

// Step 5. Where the gateway returns the payer after a 3DS challenge, with a POST. It is not a
// page, because a page cannot be delivered by POST and still be reloadable: the signature is
// checked here and the payer is sent on to /result with the same signed parameters in the
// query. The browser carries them, but it cannot forge them — it does not know
// MERCHANT_CONTROL — and /result checks them again before it serves anything.
func handleResultCallback(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		http.Error(w, "malformed callback", http.StatusBadRequest)
		return
	}
	// A GET here is nobody arriving from a payment; send them to the empty page.
	if r.Method == http.MethodPost {
		if !validCallback(r.PostForm) {
			log.Printf("[error] callback signature mismatch for order %q", r.PostForm.Get("orderid"))
			http.Error(w, "invalid callback signature", http.StatusForbidden)
			return
		}
	}

	// Built by hand rather than with url.Values.Encode, which sorts: every example puts these
	// in the same order, so the URL the payer ends up on is the same one everywhere.
	signed := make([]string, 0, len(signedCallbackFields))
	for _, name := range signedCallbackFields {
		if value := r.PostForm.Get(name); value != "" {
			signed = append(signed, url.QueryEscape(name)+"="+url.QueryEscape(value))
		}
	}

	target := cfg.BasePath + "/result"
	if len(signed) > 0 {
		target += "?" + strings.Join(signed, "&")
	}
	// 303, so the browser follows with a GET whatever it arrived with
	http.Redirect(w, r, target, http.StatusSeeOther)
}

// The 3DS return page. The callback carries the outcome too, but the documentation says not to
// treat it as the status — the page looks the order up over the API instead.
func handleResult(w http.ResponseWriter, r *http.Request) {
	// The query is only there when the payer came through the callback. Rechecking it here is
	// what stops a hand-edited URL: without it the page would happily poll somebody else's
	// order. No query at all is fine — the page then says there is nothing to show.
	query := r.URL.Query()
	if query.Get("orderid") != "" && !validCallback(query) {
		log.Printf("[error] result signature mismatch for order %q", query.Get("orderid"))
		http.Error(w, "invalid result signature", http.StatusForbidden)
		return
	}

	serveView(w, "result.html")
}

// Both pages are served straight out of the embedded files, with nothing substituted into them.
func serveView(w http.ResponseWriter, name string) {
	page, err := assets.ReadFile("views/" + name)
	if err != nil {
		log.Printf("[error] %v", err)
		http.Error(w, "page not found", http.StatusInternalServerError)
		return
	}
	securityHeaders(w)
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write(page)
}

// What a payment page ought to send. The policy is worth reading as part of the example: the
// card fields are iframes from the gateway, so the SDK host has to be named in frame-src as
// well as in script-src, and everything else is denied by default.
//
// No 'unsafe-inline' anywhere, which is why the result page's script lives in public/result.js
// rather than in the markup: nothing in views/ is templated, so there is nowhere to put a nonce.
func securityHeaders(w http.ResponseWriter) {
	policy := []string{
		"default-src 'none'",
		"script-src 'self' " + cfg.SDKOrigin,
		"style-src 'self'",
		// The three card inputs are cross-origin iframes served by the gateway
		"frame-src " + cfg.SDKOrigin,
		"connect-src 'self' " + cfg.SDKOrigin,
		"img-src 'self' data:",
		"base-uri 'none'",
		"form-action 'self'",
		"frame-ancestors 'none'",
	}
	w.Header().Set("Content-Security-Policy", strings.Join(policy, "; "))
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "no-referrer")
	// The page carries the signed order parameters in its URL, and it is one payment's page
	w.Header().Set("Cache-Control", "no-store")
}

// validCallback checks the checksum the gateway signs its callbacks with:
// sha1(status + orderid + merchant_order + merchant_control).
// https://doc.payneteasy.com/integration/API_commands/merchant_callback_parameters.html
func validCallback(form url.Values) bool {
	sum := sha1.Sum([]byte(form.Get("status") + form.Get("orderid") +
		form.Get("merchant_order") + cfg.MerchantControl))
	expected := hex.EncodeToString(sum[:])
	return subtle.ConstantTimeCompare([]byte(expected), []byte(form.Get("control"))) == 1
}

// clientIP is the payer's address, which the platform uses for fraud screening.
// Behind nginx it only arrives in X-Forwarded-For, so the proxy must set it — and the header is
// taken on trust, which is one of the reasons the app binds to loopback by default. Exposed
// straight to the internet this would let any caller pick the address the gateway screens.
func clientIP(r *http.Request) string {
	ip, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		ip = r.RemoteAddr
	}
	if forwarded := r.Header.Get("X-Forwarded-For"); forwarded != "" {
		ip = strings.TrimSpace(strings.Split(forwarded, ",")[0])
	}
	if ip == "::1" {
		return "127.0.0.1"
	}
	return strings.TrimPrefix(ip, "::ffff:")
}

func header(r *http.Request, name, fallback string) string {
	if value := r.Header.Get(name); value != "" {
		return value
	}
	return fallback
}

// Any gateway failure surfaces to the page as one 502 with a message.
func fail(w http.ResponseWriter, err error) {
	log.Printf("[error] %v", err)
	writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
}

// window.CONFIG as a script of its own: the only thing this server generates.
func writeConfigJS(w http.ResponseWriter, config map[string]string) {
	body, err := json.Marshal(config)
	if err != nil {
		log.Printf("[error] %v", err)
		http.Error(w, "could not build the page config", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
	// The ticket inside is single-use, so this must never come from a cache
	w.Header().Set("Cache-Control", "no-store")
	w.Write([]byte("window.CONFIG = " + string(body) + ";\n"))
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(body)
}
