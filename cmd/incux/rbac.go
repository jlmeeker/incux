package main

// rbac.go — role-based access control middleware.
//
// Rules (when auth is enabled):
//   - Any user whose X-Webincus-Roles header contains the role "admin" may
//     perform any request.
//   - All other authenticated users are read-only: GET, HEAD, and OPTIONS pass
//     through; any mutating method (POST, PUT, PATCH, DELETE) is rejected with
//     HTTP 403.
//
// When auth is disabled (auth == nil) the middleware is a no-op.

import (
	"net/http"
	"strings"
)

const adminRole = "admin"

// isAdmin returns true when the comma-separated roles header contains "admin".
func isAdmin(r *http.Request) bool {
	rolesHeader := r.Header.Get("X-Webincus-Roles")
	if rolesHeader == "" {
		return false
	}
	for _, role := range strings.Split(rolesHeader, ",") {
		if strings.TrimSpace(role) == adminRole {
			return true
		}
	}
	return false
}

// isMutating returns true for HTTP methods that modify state.
func isMutating(method string) bool {
	switch method {
	case http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
		return true
	}
	return false
}

// rbacMiddleware wraps next with RBAC enforcement.
// When auth is nil (disabled) the handler is returned unchanged.
func rbacMiddleware(auth Authenticator, next http.Handler) http.Handler {
	if auth == nil {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if isMutating(r.Method) && !isAdmin(r) {
			authError(w, "forbidden: admin role required for write operations", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}
