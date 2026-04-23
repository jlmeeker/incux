package main

import (
	"encoding/json"
	"io/fs"
	"net/http"
)

// registerRoutes wires all API and static routes onto mux.
// Every /api/1.0/* route proxies through to Incus with the /api prefix stripped.
func registerRoutes(mux *http.ServeMux, static fs.FS) {
	auth := newAuthenticator()

	// Middleware chain: auth → rbac → logger → proxy
	withAuth := func(h http.Handler) http.Handler {
		return authMiddleware(auth, rbacMiddleware(auth, h))
	}

	proxy      := withAuth(incusLogger(incusProxy("/api")))
	remoteProxy := withAuth(incusLogger(remoteProxyHandler()))

	mux.HandleFunc("/health", handleHealth)

	// Identity endpoint — returns the authenticated user extracted from headers
	// set by the auth middleware. Safe to call with no auth (returns empty user).
	mux.Handle("/whoami", authMiddleware(auth, http.HandlerFunc(whoamiHandler)))

	// Remote registry — lists configured remotes
	mux.HandleFunc("/api/remotes", handleRemotesList)

	// Per-remote proxy: /api/remotes/<name>/1.0/...
	// Must come before the generic /api/ catch-all.
	mux.Handle("/api/remotes/", remoteProxy)

	// Incus root & server info
	mux.Handle("/api/", proxy)
	mux.Handle("/api/1.0", proxy)
	mux.Handle("/api/1.0/resources", proxy)

	// Instances — POST is intercepted to resolve image aliases before proxying
	mux.Handle("/api/1.0/instances", handleCreateInstance(proxy))
	mux.Handle("/api/1.0/instances/", proxy)

	// Images
	mux.Handle("/api/1.0/images", proxy)
	mux.Handle("/api/1.0/images/", proxy)

	// Networks
	mux.Handle("/api/1.0/networks", proxy)
	mux.Handle("/api/1.0/networks/", proxy)

	// Storage
	mux.Handle("/api/1.0/storage-pools", proxy)
	mux.Handle("/api/1.0/storage-pools/", proxy)

	// Profiles
	mux.Handle("/api/1.0/profiles", proxy)
	mux.Handle("/api/1.0/profiles/", proxy)

	// Projects
	mux.Handle("/api/1.0/projects", proxy)
	mux.Handle("/api/1.0/projects/", proxy)

	// Cluster
	mux.Handle("/api/1.0/cluster", proxy)
	mux.Handle("/api/1.0/cluster/", proxy)

	// Operations
	mux.Handle("/api/1.0/operations", proxy)
	mux.Handle("/api/1.0/operations/", proxy)

	// Events (SSE / WebSocket)
	mux.Handle("/api/1.0/events", proxy)

	// Warnings
	mux.Handle("/api/1.0/warnings", proxy)
	mux.Handle("/api/1.0/warnings/", proxy)

	// SPA catch-all: serve real static assets; fall back to index.html for
	// all other paths so the SolidJS router handles client-side navigation
	// on hard refresh (e.g. loading /instances directly).
	mux.Handle("/", spaHandler(static))
}

// spaHandler serves static files from fsys and falls back to index.html for
// any path that doesn't correspond to a real file.
func spaHandler(fsys fs.FS) http.Handler {
	fileServer := http.FileServer(http.FS(fsys))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Strip the leading "/" so Open() works correctly with embed.FS paths.
		path := r.URL.Path
		if len(path) > 0 && path[0] == '/' {
			path = path[1:]
		}
		if path == "" {
			path = "."
		}

		f, err := fsys.Open(path)
		if err != nil {
			// Not a real file — serve index.html for SPA routing.
			r2 := r.Clone(r.Context())
			r2.URL.Path = "/"
			fileServer.ServeHTTP(w, r2)
			return
		}
		f.Close()
		fileServer.ServeHTTP(w, r)
	})
}

// handleHealth returns a simple liveness response.
func handleHealth(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}
