package main

// OAuth 1.0a RSA-SHA256 request signing.
// https://doc.payneteasy.com/integration/general_api_usage/request_authentication_methods/oauth.html

import (
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/pem"
	"errors"
	"fmt"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
)

// parsePrivateKey accepts a PKCS#8 or PKCS#1 PEM, with real newlines or with
// escaped \n, so the key can also live on a single line in an env variable.
func parsePrivateKey(text string) (*rsa.PrivateKey, error) {
	block, _ := pem.Decode([]byte(strings.ReplaceAll(text, `\n`, "\n")))
	if block == nil {
		return nil, errors.New("the private key is not a valid PEM block")
	}
	if key, err := x509.ParsePKCS8PrivateKey(block.Bytes); err == nil {
		rsaKey, ok := key.(*rsa.PrivateKey)
		if !ok {
			return nil, fmt.Errorf("the private key is %T, an RSA key is required", key)
		}
		return rsaKey, nil
	}
	return x509.ParsePKCS1PrivateKey(block.Bytes)
}

// authHeader builds the Authorization header for a signed API call.
// params are the x-www-form-urlencoded parameters of the request, if any.
func authHeader(method, endpoint string, params url.Values) (string, error) {
	nonce := make([]byte, 16)
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	oauth := url.Values{
		"oauth_consumer_key":     {cfg.MerchantLogin},
		"oauth_nonce":            {hex.EncodeToString(nonce)},
		"oauth_signature_method": {"RSA-SHA256"},
		"oauth_timestamp":        {strconv.FormatInt(time.Now().Unix(), 10)},
		"oauth_version":          {"1.0"},
	}

	// Signature base string: METHOD&url&sorted-parameters, each part percent-encoded
	signed := url.Values{}
	for _, source := range []url.Values{params, oauth} {
		for key, values := range source {
			signed[key] = values
		}
	}
	baseString := strings.ToUpper(method) + "&" + encode(endpoint) + "&" + encode(normalize(signed))

	digest := sha256.Sum256([]byte(baseString))
	signature, err := rsa.SignPKCS1v15(rand.Reader, cfg.privateKey, crypto.SHA256, digest[:])
	if err != nil {
		return "", err
	}
	oauth.Set("oauth_signature", base64.StdEncoding.EncodeToString(signature))

	// Header values are not encoded by the transport, so encode them here
	pairs := make([]string, 0, len(oauth))
	for _, key := range sortedKeys(oauth) {
		pairs = append(pairs, key+`="`+encode(oauth.Get(key))+`"`)
	}
	return "OAuth " + strings.Join(pairs, ", "), nil
}

func normalize(params url.Values) string {
	pairs := make([]string, 0, len(params))
	for _, key := range sortedKeys(params) {
		pairs = append(pairs, encode(key)+"="+encode(params.Get(key)))
	}
	return strings.Join(pairs, "&")
}

func sortedKeys(params url.Values) []string {
	keys := make([]string, 0, len(params))
	for key := range params {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

// encode is RFC 3986 percent encoding: url.QueryEscape writes a space as +
// and leaves ! ' ( ) * alone, both of which break the signature.
func encode(value string) string {
	const unreserved = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~"

	var out strings.Builder
	for _, b := range []byte(value) {
		if strings.IndexByte(unreserved, b) >= 0 {
			out.WriteByte(b)
		} else {
			fmt.Fprintf(&out, "%%%02X", b)
		}
	}
	return out.String()
}
