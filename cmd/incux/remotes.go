package main

import (
	"crypto/tls"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

// Remote represents a named Incus server connection target.
type Remote struct {
	Name    string `json:"name"`
	Address string `json:"address"`

	// TLS fields — populated from Incus CLI config, not sent to frontend.
	tlsClientCert []byte // PEM client cert
	tlsClientKey  []byte // PEM client key
}

// incusConfigFile is the Incus CLI config structure (subset we care about).
type incusConfigFile struct {
	Remotes     map[string]incusRemoteConfig `yaml:"remotes"`
	DefaultRemote string                      `yaml:"default-remote"`
}

type incusRemoteConfig struct {
	Addr     string `yaml:"addr"`
	AuthType string `yaml:"auth_type"`
	Protocol string `yaml:"protocol"`
}

// remoteRegistry holds all configured remotes, keyed by name.
var remoteRegistry map[string]Remote

func init() {
	remoteRegistry = make(map[string]Remote)

	// "local" is present only when the socket/address is actually reachable.
	// If INCUS_ADDR is explicitly set we always honour it; otherwise we only
	// register "local" when the default unix socket exists on disk.
	localAddr := incusAddr()
	registerLocal := true
	if os.Getenv("INCUS_ADDR") == "" {
		// Default path — only add "local" if the socket file is present.
		socketPath := strings.TrimPrefix(localAddr, "unix://")
		if _, err := os.Stat(socketPath); err != nil {
			registerLocal = false
			log.Printf("remotes: local Incus socket not found (%s), skipping 'local' remote", socketPath)
		}
	}
	if registerLocal {
		remoteRegistry["local"] = Remote{
			Name:    "local",
			Address: localAddr,
		}
	}

	// Load Incus CLI config to auto-discover remotes.
	loadIncusCliConfig()

	// Env var overrides: INCUS_REMOTE_<NAME>=<addr>
	// These take precedence over anything from the CLI config.
	for _, env := range os.Environ() {
		const prefix = "INCUS_REMOTE_"
		if !strings.HasPrefix(env, prefix) {
			continue
		}
		parts := strings.SplitN(env, "=", 2)
		if len(parts) != 2 || parts[1] == "" {
			continue
		}
		name := strings.ToLower(strings.TrimPrefix(parts[0], prefix))
		if name == "" {
			continue
		}
		// Merge TLS config if the remote already exists, just override address.
		existing := remoteRegistry[name]
		existing.Name = name
		existing.Address = parts[1]
		remoteRegistry[name] = existing
	}
}

// incusConfigDir returns the Incus CLI config directory.
func incusConfigDir() string {
	if v := os.Getenv("INCUS_CONF"); v != "" {
		return v
	}
	home, _ := os.UserHomeDir()
	// Try XDG path first, then legacy
	xdg := filepath.Join(home, ".config", "incus")
	if _, err := os.Stat(xdg); err == nil {
		return xdg
	}
	return filepath.Join(home, ".local", "share", "incus")
}

// loadIncusCliConfig reads ~/.config/incus/config.yml and populates remoteRegistry
// with any HTTPS remotes found there, loading their client certs.
func loadIncusCliConfig() {
	dir := incusConfigDir()
	cfgPath := filepath.Join(dir, "config.yml")

	data, err := os.ReadFile(cfgPath)
	if err != nil {
		// No config file — silently skip.
		return
	}

	var cfg incusConfigFile
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		log.Printf("remotes: failed to parse %s: %v", cfgPath, err)
		return
	}

	// Load the shared client cert/key once.
	clientCert, clientKey, err := loadClientCreds(dir)
	if err != nil {
		log.Printf("remotes: client creds unavailable: %v", err)
	}

	for name, rc := range cfg.Remotes {
		addr := rc.Addr
		if addr == "" {
			continue
		}
		// Skip the built-in local unix remote — we handle that via INCUS_ADDR.
		if addr == "unix://" || strings.HasPrefix(addr, "unix://") {
			if name == "local" {
				continue
			}
		}
		// Normalise: Incus CLI stores HTTPS addresses without trailing slash.
		// Ensure scheme is present.
		if !strings.Contains(addr, "://") {
			addr = "https://" + addr
		}

		remote := Remote{
			Name:          name,
			Address:       addr,
			tlsClientCert: clientCert,
			tlsClientKey:  clientKey,
		}

		remoteRegistry[name] = remote
		log.Printf("remotes: discovered %q → %s", name, addr)
	}
}

// loadClientCreds reads the shared Incus client cert and key.
func loadClientCreds(configDir string) (cert []byte, key []byte, err error) {
	certPath := filepath.Join(configDir, "client.crt")
	keyPath := filepath.Join(configDir, "client.key")

	cert, err = os.ReadFile(certPath)
	if err != nil {
		return nil, nil, fmt.Errorf("client.crt: %w", err)
	}
	key, err = os.ReadFile(keyPath)
	if err != nil {
		return nil, nil, fmt.Errorf("client.key: %w", err)
	}
	return cert, key, nil
}

// tlsConfigForRemote builds a *tls.Config for the given remote.
// Incus remotes use self-signed certificates by default, so we skip server
// verification and rely on mutual TLS (client cert) for authentication instead.
func tlsConfigForRemote(remote Remote) *tls.Config {
	cfg := &tls.Config{
		InsecureSkipVerify: true, //nolint:gosec — Incus uses self-signed certs; auth is via client cert
	}

	// Client certificate — presented to the Incus server for authentication.
	if len(remote.tlsClientCert) > 0 && len(remote.tlsClientKey) > 0 {
		cert, err := tls.X509KeyPair(remote.tlsClientCert, remote.tlsClientKey)
		if err != nil {
			log.Printf("remotes: failed to load client cert for %s: %v", remote.Name, err)
		} else {
			cfg.Certificates = []tls.Certificate{cert}
		}
	}

	return cfg
}

// ── Registry helpers ──────────────────────────────────────────────────────────

// lookupRemote returns the Remote for the given name, and whether it exists.
func lookupRemote(name string) (Remote, bool) {
	r, ok := remoteRegistry[strings.ToLower(name)]
	return r, ok
}

// listRemotes returns all remotes sorted by name for the frontend.
func listRemotes() []Remote {
	out := make([]Remote, 0, len(remoteRegistry))
	for _, r := range remoteRegistry {
		// Only expose name + address to the frontend.
		out = append(out, Remote{Name: r.Name, Address: r.Address})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Name == "local" {
			return true
		}
		if out[j].Name == "local" {
			return false
		}
		return out[i].Name < out[j].Name
	})
	return out
}

// ── HTTP handlers ─────────────────────────────────────────────────────────────

// handleRemotesList serves GET /api/remotes.
func handleRemotesList(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(listRemotes())
}

// remoteProxyHandler proxies /api/remotes/<name>/1.0/... to the named remote.
func remoteProxyHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/api/remotes/")
		slash := strings.IndexByte(path, '/')
		if slash < 0 {
			http.Error(w, "missing remote path", http.StatusBadRequest)
			return
		}
		remoteName := path[:slash]
		rest := path[slash:]

		remote, ok := lookupRemote(remoteName)
		if !ok {
			http.Error(w, "unknown remote: "+remoteName, http.StatusNotFound)
			return
		}

		r.URL.Path = rest
		if r.URL.Path == "" {
			r.URL.Path = "/"
		}

		addr := remote.Address
		isWS := strings.EqualFold(r.Header.Get("Upgrade"), "websocket")

		switch {
		case strings.HasPrefix(addr, "https://"):
			tlsCfg := tlsConfigForRemote(remote)
			if isWS {
				tunnelTLS(addr, tlsCfg, w, r)
			} else {
				proxyHTTPS(addr, tlsCfg, w, r)
			}
		case strings.HasPrefix(addr, "http://"):
			if isWS {
				tunnelHTTP(addr, w, r)
			} else {
				proxyHTTP(addr, w, r)
			}
		case strings.HasPrefix(addr, "unix://"):
			socketPath := strings.TrimPrefix(addr, "unix://")
			if isWS {
				tunnelUnix(socketPath, w, r)
			} else {
				proxyUnix(socketPath, w, r)
			}
		default:
			http.Error(w, "unsupported remote address scheme", http.StatusBadGateway)
		}
	})
}

// ── TLS-aware proxy and tunnel ────────────────────────────────────────────────

// proxyHTTPS reverse-proxies to an HTTPS Incus remote with the given TLS config.
func proxyHTTPS(addr string, tlsCfg *tls.Config, w http.ResponseWriter, r *http.Request) {
	target, err := url.Parse(addr)
	if err != nil {
		http.Error(w, "invalid remote address", http.StatusBadGateway)
		return
	}
	rp := &httputil.ReverseProxy{
		Director: func(req *http.Request) {
			req.URL.Scheme = target.Scheme
			req.URL.Host = target.Host
			req.Host = target.Host
		},
		Transport: &http.Transport{
			TLSClientConfig:    tlsCfg,
			DisableCompression: true,
		},
		FlushInterval: -1,
		ErrorHandler: func(rw http.ResponseWriter, req *http.Request, err error) {
			log.Printf("proxy https error: %v", err)
			http.Error(rw, "upstream error: "+err.Error(), http.StatusBadGateway)
		},
	}
	rp.ServeHTTP(w, r)
}

// tunnelTLS dials a TLS upstream and splices the raw bytes (for WebSocket over HTTPS).
func tunnelTLS(addr string, tlsCfg *tls.Config, w http.ResponseWriter, r *http.Request) {
	u, err := url.Parse(addr)
	if err != nil {
		http.Error(w, "invalid remote address", http.StatusBadGateway)
		return
	}
	host := u.Host
	if !strings.Contains(host, ":") {
		host += ":443"
	}

	dialer := &tls.Dialer{
		NetDialer: &net.Dialer{Timeout: 10 * time.Second},
		Config:    tlsCfg,
	}
	upstream, err := dialer.Dial("tcp", host)
	if err != nil {
		log.Printf("tunnel tls dial error: %v", err)
		http.Error(w, "upstream dial error: "+err.Error(), http.StatusBadGateway)
		return
	}
	tunnel(upstream, w, r)
}

// ── YAML dependency ───────────────────────────────────────────────────────────
// gopkg.in/yaml.v3 is used to parse the Incus CLI config.yml file.
