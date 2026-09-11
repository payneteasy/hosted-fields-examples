package main

import (
	"crypto/sha1"
	"crypto/subtle"
	"embed"
	"encoding/hex"
	"encoding/json"
	"html/template"
	"io/fs"
	"log"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

//go:embed views public
var assets embed.FS

var pages = template.Must(template.ParseFS(assets, "views/*.html"))

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
	mux.HandleFunc("GET "+cfg.BasePath+"/{$}", handleCheckout)
	mux.HandleFunc("POST "+cfg.BasePath+"/pay", handlePay)
	mux.HandleFunc("GET "+cfg.BasePath+"/status", handleStatus)
	// The gateway returns the payer from a 3DS challenge with a POST, not a GET,
	// so both methods have to be accepted here.
	mux.HandleFunc("GET "+cfg.BasePath+"/result", handleResult)
	mux.HandleFunc("POST "+cfg.BasePath+"/result", handleResult)
	// Stylesheet and client scripts. Registering the subtree also makes the mux
	// redirect a request for the bare prefix to the trailing-slash form, which
	// keeps the relative asset URLs on the payment page working.
	mux.Handle("GET "+cfg.BasePath+"/", http.StripPrefix(cfg.BasePath+"/", http.FileServerFS(public)))

	address := ":" + cfg.Port
	log.Printf("listening on http://localhost%s%s/", address, cfg.BasePath)
	log.Fatal(http.ListenAndServe(address, mux))
}

// Step 1. A fresh single-use ticket for every page load, embedded into the page.
func handleCheckout(w http.ResponseWriter, r *http.Request) {
	ticket, err := getEphemeralTicket()
	if err != nil {
		fail(w, err)
		return
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	err = pages.ExecuteTemplate(w, "checkout.html", map[string]string{
		"basePath":        cfg.BasePath,
		"sdkUrl":          cfg.SDKURL,
		"endpointId":      cfg.EndpointID,
		"ephemeralTicket": ticket,
		// The page shows what the server will actually charge
		"amount":   cfg.OrderAmount,
		"currency": cfg.OrderCurrency,
	})
	if err != nil {
		log.Printf("[error] %v", err)
	}
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

	browser := url.Values{}
	for key, value := range payment.Browser {
		browser.Set(key, value)
	}
	browser.Set("customer_browser_accept_header", header(r, "Accept", "*/*"))
	browser.Set("customer_browser_user_agent", header(r, "User-Agent", ""))

	clientOrderID := "hf-" + strconv.FormatInt(time.Now().UnixMilli(), 10)
	sale, err := createSale(payment.HostedFieldsToken, clientOrderID, clientIP(r), browser, payment.Customer)
	if err != nil {
		fail(w, err)
		return
	}

	sale["clientOrderId"] = clientOrderID
	writeJSON(w, http.StatusOK, sale)
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

// Step 5. Where the payer lands after a 3DS challenge. The gateway returns the
// payer with a POST whose parameters are signed, so the order is taken from
// there — the browser is never asked to carry it across the redirect.
func handleResult(w http.ResponseWriter, r *http.Request) {
	page := map[string]string{
		"basePath": cfg.BasePath,
		"amount":   cfg.OrderAmount,
		"currency": cfg.OrderCurrency,
	}

	if r.Method == http.MethodPost {
		if err := r.ParseForm(); err != nil {
			http.Error(w, "malformed callback", http.StatusBadRequest)
			return
		}
		if !validCallback(r.PostForm) {
			log.Printf("[error] callback signature mismatch for order %q", r.PostForm.Get("orderid"))
			http.Error(w, "invalid callback signature", http.StatusForbidden)
			return
		}
		// The callback carries the outcome too, but the documentation says not to
		// treat it as the status — the order is looked up over the API instead.
		page["orderId"] = r.PostForm.Get("orderid")
		page["clientOrderId"] = r.PostForm.Get("merchant_order")
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if err := pages.ExecuteTemplate(w, "result.html", page); err != nil {
		log.Printf("[error] %v", err)
	}
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
// Behind nginx it only arrives in X-Forwarded-For, so the proxy must set it.
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

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(body)
}
