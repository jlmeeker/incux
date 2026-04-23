package main

import (
	"encoding/json"
	"net/http"
	"strings"
)

// whoamiHandler returns the authenticated user's identity as JSON.
// Used by the frontend to display the current user in the topbar.
// Returns {"user":"","roles":[],"is_admin":false} when auth is disabled.
func whoamiHandler(w http.ResponseWriter, r *http.Request) {
	user := r.Header.Get("X-Webincus-User")
	rolesHeader := r.Header.Get("X-Webincus-Roles")

	var roles []string
	if rolesHeader != "" {
		roles = strings.Split(rolesHeader, ",")
	} else {
		roles = []string{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"user":     user,
		"roles":    roles,
		"is_admin": isAdmin(r),
	})
}
