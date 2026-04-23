package main

import (
	"log"
	"net/http"
	"strings"
	"time"
)

// incusObjectPrefixes are the URL path prefixes (after /api strip) that
// represent Incus managed objects.  Read-only informational endpoints
// (resources, events, operations, server info) are excluded so that only
// meaningful object actions are logged.
var incusObjectPrefixes = []string{
	"/1.0/instances",
	"/1.0/images",
	"/1.0/networks",
	"/1.0/storage-pools",
	"/1.0/profiles",
	"/1.0/cluster",
}

// responseRecorder wraps http.ResponseWriter to capture the status code
// written by the downstream handler.
type responseRecorder struct {
	http.ResponseWriter
	status int
}

func (rr *responseRecorder) WriteHeader(code int) {
	rr.status = code
	rr.ResponseWriter.WriteHeader(code)
}

// incusLogger wraps an http.Handler and logs every request that targets an
// Incus object.  The log line includes:
//
//	[INCUS] <METHOD> <path> — <status> (<duration>) from <remote>
func incusLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Derive the Incus-side path.
		// For local routes the path is /api/1.0/... → strip /api.
		// For remote routes the path is /api/remotes/<name>/1.0/... → strip /api/remotes/<name>.
		incusPath := r.URL.Path
		if idx := strings.Index(incusPath, "/1.0"); idx >= 0 {
			incusPath = incusPath[idx:]
		} else {
			incusPath = strings.TrimPrefix(incusPath, "/api")
		}
		if incusPath == "" {
			incusPath = "/"
		}

		if !isIncusObjectPath(incusPath) {
			next.ServeHTTP(w, r)
			return
		}

		rr := &responseRecorder{ResponseWriter: w, status: http.StatusOK}
		start := time.Now()
		next.ServeHTTP(rr, r)
		duration := time.Since(start)

		log.Printf("[INCUS] %s %s — %d (%s) from %s",
			r.Method, r.URL.Path, rr.status, duration.Round(time.Millisecond), r.RemoteAddr)
	})
}

// isIncusObjectPath reports whether path falls under a known Incus object prefix.
func isIncusObjectPath(path string) bool {
	for _, prefix := range incusObjectPrefixes {
		if path == prefix || strings.HasPrefix(path, prefix+"/") {
			return true
		}
	}
	return false
}
