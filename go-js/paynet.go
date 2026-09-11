package main

// The three gateway calls the Hosted Fields flow needs.
// https://doc.payneteasy.com/integration/api_use_cases/hosted_fields.html

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"
)

var gateway = &http.Client{Timeout: 30 * time.Second}

// A decoded gateway reply. Keys are the documented kebab-case names; values are
// mostly strings, but not always — error-code is a number in a sale response.
type response map[string]any

// getEphemeralTicket returns a single-use ticket the browser exchanges for a
// hosted fields token. It is valid for 15 minutes and safe to put on the page.
func getEphemeralTicket() (string, error) {
	decoded, err := postJSON("/api/v4/tokenize/create-ephemeral-ticket/", nil)
	if err != nil {
		return "", err
	}
	ticket, ok := decoded["ephemeralTicket"].(string)
	if !ok || strings.TrimSpace(ticket) == "" {
		// A rejected request comes back as 4xx with a JSON body carrying the reason. Only that
		// one field is quoted: this reason travels on into config.js, where the browser can
		// read it, and the rest of the reply is the gateway's business and not the payer's.
		if message, found := decoded["error-message"].(string); found && message != "" {
			return "", fmt.Errorf("no ephemeralTicket: %s", message)
		}
		return "", errors.New("no ephemeralTicket in the response")
	}
	return strings.TrimSpace(ticket), nil
}

// Payer details collected by our own inputs, next to the card iframes.
type customer struct {
	FirstName string `json:"firstName"`
	LastName  string `json:"lastName"`
	Email     string `json:"email"`
	// The card holder name, composed by the page from the two above: the hosted fields token
	// does not carry it, and with the token the platform leaves the holder empty unless it is
	// sent here — which some acquirers do not survive.
	CardPrintedName string `json:"cardPrintedName"`
}

// createSale charges the card behind the hosted fields token. The token replaces
// credit_card_number, expire_month, expire_year and cvv2 — sending those is an error.
func createSale(hostedFieldsToken, clientOrderID, ipAddress string, browser url.Values, payer customer) (response, error) {
	params := url.Values{
		"client_orderid":      {clientOrderID},
		"order_desc":          {"Hosted Fields example order"},
		"amount":              {cfg.OrderAmount},
		"currency":            {cfg.OrderCurrency},
		"hosted_fields_token": {hostedFieldsToken},
		"card_printed_name":   {payer.CardPrintedName},
		"first_name":          {payer.FirstName},
		"last_name":           {payer.LastName},
		"address1":            {"100 Main st"},
		"city":                {"Seattle"},
		"zip_code":            {"98102"},
		"country":             {"US"},
		"state":               {"WA"},
		"phone":               {"+12063582043"},
		"email":               {payer.Email},
		"ipaddress":           {ipAddress},
		"redirect_url":        {cfg.redirectURL()},
	}
	// 3DS 2.0 browser data, required by /api/v4/sale. It comes from the page, so a parameter the
	// server has already set is never taken from it: handlePay filters the body to the documented
	// keys and this loop refuses to overwrite, so neither guard is load-bearing on its own.
	for key, values := range browser {
		if _, taken := params[key]; !taken {
			params[key] = values
		}
	}
	return postJSON("/api/v4/sale/", params)
}

// getStatus is polled until the order reaches a final status.
func getStatus(orderID, clientOrderID string) (response, error) {
	return postJSON("/api/v4/status/", url.Values{
		"login":          {cfg.MerchantLogin},
		"client_orderid": {clientOrderID},
		"orderid":        {orderID},
	})
}

// postJSON sends a signed command and decodes the reply. A rejected request —
// a validation error or a decline — comes back as 4xx with a JSON body, so the
// body is decoded whatever the status: it carries the error-message for the page.
// Only a reply that is not JSON at all counts as a failure of the call itself.
func postJSON(command string, params url.Values) (response, error) {
	body, status, err := post(command, params)
	if err != nil {
		return nil, err
	}
	var decoded response
	if err := json.Unmarshal(body, &decoded); err != nil {
		// The body is not quoted: it reaches the page as {error}. The log above has the detail.
		return nil, fmt.Errorf("gateway request failed with %d", status)
	}
	return decoded, nil
}

func post(command string, params url.Values) ([]byte, int, error) {
	endpoint := cfg.APIURL + command + cfg.EndpointID

	request, err := http.NewRequest(http.MethodPost, endpoint, strings.NewReader(params.Encode()))
	if err != nil {
		return nil, 0, err
	}
	authorization, err := authHeader(http.MethodPost, endpoint, params)
	if err != nil {
		return nil, 0, err
	}
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	// Ask for JSON instead of the default x-www-form-urlencoded reply.
	// https://doc.payneteasy.com/integration/openapi.html
	request.Header.Set("Accept", "application/vnd.pay+json")
	request.Header.Set("Authorization", authorization)

	result, err := gateway.Do(request)
	if err != nil {
		return nil, 0, err
	}
	defer result.Body.Close()

	body, err := io.ReadAll(result.Body)
	if err != nil {
		return nil, 0, err
	}
	log.Printf("[paynet] POST %s -> %d%s", endpoint, result.StatusCode, logReason(body))
	return body, result.StatusCode, nil
}

// logReason is what goes in the log beside the status code. Not the body: a status reply carries
// the card's last four digits and the holder's name, and the ticket reply carries the ticket.
// The gateway puts everything a log needs to be useful into these two fields anyway.
func logReason(body []byte) string {
	var decoded struct {
		OrderID string `json:"paynet-order-id"`
		Message string `json:"error-message"`
	}
	if err := json.Unmarshal(body, &decoded); err != nil {
		return " (reply is not JSON)"
	}
	reason := ""
	if decoded.OrderID != "" {
		reason += " order " + decoded.OrderID
	}
	if decoded.Message != "" {
		reason += " " + oneLine([]byte(decoded.Message))
	}
	return reason
}

func oneLine(body []byte) string {
	return strings.Join(strings.Fields(string(body)), " ")
}
