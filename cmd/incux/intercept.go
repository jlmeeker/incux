package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log"
	"net"
	"net/http"
	"strings"
	"time"
)

const (
	imagesServer   = "https://images.linuxcontainers.org"
	imagesProtocol = "simplestreams"
)

// instanceSource mirrors the "source" field of a POST /1.0/instances body.
type instanceSource struct {
	Type        string `json:"type"`
	Alias       string `json:"alias,omitempty"`
	Fingerprint string `json:"fingerprint,omitempty"`
	Server      string `json:"server,omitempty"`
	Protocol    string `json:"protocol,omitempty"`
	Mode        string `json:"mode,omitempty"`
}

// instanceCreateBody is the minimal shape we need to inspect/rewrite.
type instanceCreateBody struct {
	Source instanceSource         `json:"source"`
	Rest   map[string]interface{} `json:"-"`
}

// handleCreateInstance intercepts POST /api/1.0/instances.
// If the source is an image alias with no server specified, it checks whether
// the alias exists locally; if not it adds server/protocol pointing to
// images.linuxcontainers.org so Incus can pull it from the remote.
// All other requests are passed straight through to Incus.
func handleCreateInstance(proxy http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			proxy.ServeHTTP(w, r)
			return
		}

		body, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, "failed to read request body", http.StatusBadRequest)
			return
		}

		// Parse into a generic map so we preserve all fields.
		var payload map[string]interface{}
		if err := json.Unmarshal(body, &payload); err != nil {
			// Not JSON — pass through unchanged.
			r.Body = io.NopCloser(bytes.NewReader(body))
			proxy.ServeHTTP(w, r)
			return
		}

		// Only rewrite if source.type == "image", source.alias is set, and
		// source.server is absent (no explicit remote already provided).
		src, _ := payload["source"].(map[string]interface{})
		if src != nil &&
			src["type"] == "image" &&
			src["alias"] != "" &&
			src["server"] == nil &&
			src["fingerprint"] == nil {

			alias, _ := src["alias"].(string)
			if !isLocalAlias(alias) {
				log.Printf("resolve: alias %q not local, routing to %s", alias, imagesServer)
				src["server"] = imagesServer
				src["protocol"] = imagesProtocol
				src["mode"] = "pull"
				payload["source"] = src
			}
		}

		rewritten, err := json.Marshal(payload)
		if err != nil {
			http.Error(w, "failed to rewrite request", http.StatusInternalServerError)
			return
		}

		r.Body = io.NopCloser(bytes.NewReader(rewritten))
		r.ContentLength = int64(len(rewritten))
		proxy.ServeHTTP(w, r)
	})
}

// isLocalAlias returns true if the alias exists in the local Incus image store.
func isLocalAlias(alias string) bool {
	addr := incusAddr()

	var rawURL string
	var transport http.RoundTripper

	switch {
	case strings.HasPrefix(addr, "http://") || strings.HasPrefix(addr, "https://"):
		rawURL = strings.TrimRight(addr, "/") + "/1.0/images/aliases/" + alias
	case strings.HasPrefix(addr, "unix://"):
		socketPath := strings.TrimPrefix(addr, "unix://")
		transport = &http.Transport{
			DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
				return (&net.Dialer{Timeout: 5 * time.Second}).DialContext(ctx, "unix", socketPath)
			},
		}
		rawURL = "http://incus/1.0/images/aliases/" + alias
	default:
		return false
	}

	client := &http.Client{Timeout: 5 * time.Second, Transport: transport}
	resp, err := client.Get(rawURL)
	if err != nil {
		return false
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return false
	}

	var result struct {
		ErrorCode int `json:"error_code"`
		Metadata  struct {
			Target string `json:"target"`
		} `json:"metadata"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return false
	}

	return result.ErrorCode == 0 && result.Metadata.Target != ""
}
