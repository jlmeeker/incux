package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// ── isAdmin ───────────────────────────────────────────────────────────────────

func TestIsAdmin(t *testing.T) {
	tests := []struct {
		name   string
		header string
		want   bool
	}{
		{"single admin role", "admin", true},
		{"admin among multiple roles", "viewer,admin,editor", true},
		{"admin with spaces", " admin , viewer", true},
		{"no roles", "", false},
		{"non-admin role", "viewer", false},
		{"partial match should not count", "administrator", false},
		{"empty role entry", ",,,", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodGet, "/", nil)
			if tt.header != "" {
				r.Header.Set("X-Webincus-Roles", tt.header)
			}
			if got := isAdmin(r); got != tt.want {
				t.Errorf("isAdmin() = %v, want %v (header=%q)", got, tt.want, tt.header)
			}
		})
	}
}

// ── isMutating ────────────────────────────────────────────────────────────────

func TestIsMutating(t *testing.T) {
	mutating := []string{
		http.MethodPost, http.MethodPut,
		http.MethodPatch, http.MethodDelete,
	}
	readOnly := []string{
		http.MethodGet, http.MethodHead,
		http.MethodOptions, http.MethodConnect,
	}
	for _, m := range mutating {
		if !isMutating(m) {
			t.Errorf("isMutating(%q) = false, want true", m)
		}
	}
	for _, m := range readOnly {
		if isMutating(m) {
			t.Errorf("isMutating(%q) = true, want false", m)
		}
	}
}

// ── rbacMiddleware ────────────────────────────────────────────────────────────

// stubAuthenticator satisfies the Authenticator interface so we can enable
// RBAC without standing up a real JWT validator.
type stubAuthenticator struct{}

func (s *stubAuthenticator) Authenticate(r *http.Request) (*Identity, error) {
	return &Identity{User: "test"}, nil
}

func okHandler(w http.ResponseWriter, _ *http.Request) {
	w.WriteHeader(http.StatusOK)
}

func TestRbacMiddleware_AuthDisabled(t *testing.T) {
	// When auth == nil the middleware must be a no-op — all methods pass through.
	handler := rbacMiddleware(nil, http.HandlerFunc(okHandler))
	for _, method := range []string{http.MethodGet, http.MethodPost, http.MethodDelete} {
		r := httptest.NewRequest(method, "/api/1.0/instances", nil)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if w.Code != http.StatusOK {
			t.Errorf("auth disabled: %s got %d, want 200", method, w.Code)
		}
	}
}

func TestRbacMiddleware_AdminCanMutate(t *testing.T) {
	handler := rbacMiddleware(&stubAuthenticator{}, http.HandlerFunc(okHandler))
	for _, method := range []string{http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete} {
		r := httptest.NewRequest(method, "/api/1.0/instances", nil)
		r.Header.Set("X-Webincus-Roles", "admin")
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if w.Code != http.StatusOK {
			t.Errorf("admin %s got %d, want 200", method, w.Code)
		}
	}
}

func TestRbacMiddleware_NonAdminReadOnly(t *testing.T) {
	handler := rbacMiddleware(&stubAuthenticator{}, http.HandlerFunc(okHandler))

	// GET/HEAD/OPTIONS must pass through.
	for _, method := range []string{http.MethodGet, http.MethodHead, http.MethodOptions} {
		r := httptest.NewRequest(method, "/api/1.0/instances", nil)
		r.Header.Set("X-Webincus-Roles", "viewer")
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if w.Code != http.StatusOK {
			t.Errorf("non-admin %s got %d, want 200", method, w.Code)
		}
	}

	// Mutating methods must be blocked with 403.
	for _, method := range []string{http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete} {
		r := httptest.NewRequest(method, "/api/1.0/instances", nil)
		r.Header.Set("X-Webincus-Roles", "viewer")
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if w.Code != http.StatusForbidden {
			t.Errorf("non-admin %s got %d, want 403", method, w.Code)
		}
	}
}

func TestRbacMiddleware_NoRoles(t *testing.T) {
	// Authenticated but no roles header at all — should also be blocked.
	handler := rbacMiddleware(&stubAuthenticator{}, http.HandlerFunc(okHandler))
	r := httptest.NewRequest(http.MethodPost, "/api/1.0/instances", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	if w.Code != http.StatusForbidden {
		t.Errorf("no roles POST got %d, want 403", w.Code)
	}
}
