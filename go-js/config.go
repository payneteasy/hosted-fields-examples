package main

import (
	"bufio"
	"crypto/rsa"
	"errors"
	"fmt"
	"os"
	"strings"
)

// Settings, all of them environment variables. See .env.example.
type config struct {
	Port          string
	BasePath      string // URL prefix everything is mounted under
	PublicURL     string // origin the payer's browser sees, no path
	APIURL        string
	SDKURL        string
	EndpointID    string
	MerchantLogin string
	// Shared secret the gateway signs its callbacks with. Not the RSA key.
	MerchantControl string
	OrderAmount     string
	OrderCurrency   string

	privateKey *rsa.PrivateKey // signs the server calls, never leaves the server
}

var cfg config

// redirectURL is where the payer lands after a 3DS challenge. It is built from
// PUBLIC_URL, not from the listen address, which behind a proxy is not the same.
func (c config) redirectURL() string { return c.PublicURL + c.BasePath + "/result/callback" }

func loadConfig(envFile string) (config, error) {
	if err := loadEnvFile(envFile); err != nil {
		return config{}, err
	}

	c := config{
		Port:     env("PORT", "3001"),
		BasePath: env("BASE_PATH", "/hosted-fields-examples-go"),
		// No default: the gateway host is per-installation, and a stale one baked in here
		// would silently point a real payment somewhere it does not belong. Required below.
		APIURL:          env("API_URL", ""),
		SDKURL:          env("SDK_URL", ""),
		EndpointID:      env("ENDPOINT_ID", ""),
		MerchantLogin:   env("MERCHANT_LOGIN", ""),
		MerchantControl: env("MERCHANT_CONTROL", ""),
		OrderAmount:     env("ORDER_AMOUNT", "1.00"),
		OrderCurrency:   env("ORDER_CURRENCY", "USD"),
	}
	c.PublicURL = env("PUBLIC_URL", "http://localhost:"+c.Port)

	for name, value := range map[string]string{
		"API_URL": c.APIURL, "SDK_URL": c.SDKURL,
		"ENDPOINT_ID": c.EndpointID, "MERCHANT_LOGIN": c.MerchantLogin,
		"MERCHANT_CONTROL": c.MerchantControl,
	} {
		if value == "" {
			return config{}, fmt.Errorf("%s is not set, see .env.example", name)
		}
	}

	pem, err := readPrivateKey()
	if err != nil {
		return config{}, err
	}
	if c.privateKey, err = parsePrivateKey(pem); err != nil {
		return config{}, err
	}
	return c, nil
}

// readPrivateKey takes the key from a file on a server, or inline for local runs.
func readPrivateKey() (string, error) {
	if path := os.Getenv("PRIVATE_KEY_PATH"); path != "" {
		key, err := os.ReadFile(path)
		return string(key), err
	}
	if key := os.Getenv("PRIVATE_KEY"); key != "" {
		return key, nil
	}
	return "", errors.New("set PRIVATE_KEY_PATH or PRIVATE_KEY, see .env.example")
}

func env(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}

// loadEnvFile reads a KEY=value file into the environment, the way
// `node --env-file` does. Already set variables win, so the shell can override it.
func loadEnvFile(path string) error {
	file, err := os.Open(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		name, value, found := strings.Cut(line, "=")
		if !found {
			continue
		}
		name = strings.TrimSpace(name)
		value = strings.Trim(strings.TrimSpace(value), `"'`)
		if _, set := os.LookupEnv(name); !set {
			os.Setenv(name, value)
		}
	}
	return scanner.Err()
}
