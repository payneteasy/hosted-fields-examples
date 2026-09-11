package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/fstest"
)

// The two pages are build output and live in web/dist beside the bundle, so the handler that
// serves that directory is an allowlist rather than a file server: {prefix}/result.html must not
// be reachable, or the 3DS return page would be served without the checksum check that
// GET {prefix}/result performs. An escaped ".." is the way that goes wrong — the mux redirects a
// literal one and leaves %2e%2e alone — so it is the case this test exists for.

func TestHandleAssetAllowlist(t *testing.T) {
	cfg.BasePath = "/prefix"
	bundle = fstest.MapFS{
		"index.html":       {Data: []byte("checkout")},
		"result.html":      {Data: []byte("result")},
		"styles.css":       {Data: []byte("css")},
		"static/js/app.js": {Data: []byte("js")},
	}

	for _, tc := range []struct {
		target string
		want   int
	}{
		{"/prefix/styles.css", http.StatusOK},
		{"/prefix/static/js/app.js", http.StatusOK},

		// The pages are served by their own routes, after their own checks
		{"/prefix/index.html", http.StatusNotFound},
		{"/prefix/result.html", http.StatusNotFound},

		// The same two by way of an escaped traversal
		{"/prefix/static/%2e%2e/result.html", http.StatusNotFound},
		{"/prefix/static/js/%2e%2e/%2e%2e/index.html", http.StatusNotFound},

		// And out of the bundle altogether
		{"/prefix/%2e%2e/%2e%2e/etc/passwd", http.StatusNotFound},
		{"/prefix/static/%2e%2e/%2e%2e/prefix/result.html", http.StatusNotFound},
	} {
		recorder := httptest.NewRecorder()
		handleAsset(recorder, httptest.NewRequest(http.MethodGet, tc.target, nil))
		if recorder.Code != tc.want {
			t.Errorf("GET %s: got %d, want %d", tc.target, recorder.Code, tc.want)
		}
	}
}
