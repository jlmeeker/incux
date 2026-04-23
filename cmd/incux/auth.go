package main

// Teleport JWT authentication middleware.
//
// Enabled by setting the TELEPORT_JWKS_URL environment variable to the
// cluster's JWKS endpoint, e.g.:
//
//	TELEPORT_JWKS_URL=https://teleport.example.com/.well-known/jwks.json
//
// Optional environment variables:
//
//	TELEPORT_AUDIENCE    — expected audience claim (e.g. "https://incus.example.com").
//	                       Leave empty to skip audience validation.
//	TELEPORT_INSECURE    — set to "true" to skip TLS certificate verification
//	                       when fetching the JWKS (useful for self-signed certs).
//
// When enabled, every request must carry a valid Teleport-Jwt-Assertion header.
// The middleware injects two headers for downstream handlers:
//
//	X-Webincus-User  — Teleport username extracted from the JWT subject/username claim.
//	X-Webincus-Roles — comma-separated list of Teleport roles.
//
// When TELEPORT_JWKS_URL is not set, the middleware is a no-op (pass-through).

import (
	"crypto"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/sha512"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"hash"
	"log"
	"math/big"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

// ── Authenticator interface ───────────────────────────────────────────────────

// Identity holds the authenticated user info injected into request headers.
type Identity struct {
	User  string
	Roles []string
}

// Authenticator validates a request and returns an Identity.
// Returning a non-nil error causes the middleware to reject the request.
// A nil error with an empty Identity means "pass through unauthenticated"
// (only appropriate when auth is disabled).
type Authenticator interface {
	Authenticate(r *http.Request) (*Identity, error)
}

// authMiddleware wraps a handler with authentication using the provided Authenticator.
// If auth is nil (disabled), requests pass through unchanged.
func authMiddleware(auth Authenticator, next http.Handler) http.Handler {
	if auth == nil {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id, err := auth.Authenticate(r)
		if err != nil {
			authError(w, err.Error(), http.StatusUnauthorized)
			return
		}
		if id != nil {
			r.Header.Set("X-Webincus-User", id.User)
			r.Header.Set("X-Webincus-Roles", strings.Join(id.Roles, ","))
		}
		next.ServeHTTP(w, r)
	})
}

func authError(w http.ResponseWriter, msg string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

// newAuthenticator reads environment variables and returns the appropriate
// Authenticator, or nil if authentication is disabled.
// Add new mechanisms here as additional else-if branches.
func newAuthenticator() Authenticator {
	if strings.EqualFold(os.Getenv("AUTH_DISABLED"), "true") {
		log.Println("auth: AUTH_DISABLED=true — authentication disabled")
		return nil
	}

	if jwksURL := os.Getenv("TELEPORT_JWKS_URL"); jwksURL != "" {
		insecure := strings.EqualFold(os.Getenv("TELEPORT_INSECURE"), "true")
		audience := os.Getenv("TELEPORT_AUDIENCE")
		log.Printf("auth: Teleport JWT authentication enabled (jwks=%s audience=%q insecure=%v)",
			jwksURL, audience, insecure)
		return &teleportAuthenticator{
			cache:    newKeyCache(jwksURL, insecure),
			audience: audience,
		}
	}

	log.Println("auth: no authentication configured — running unauthenticated")
	return nil
}

// ── Teleport JWT Authenticator ────────────────────────────────────────────────

type teleportAuthenticator struct {
	cache    *keyCache
	audience string
}

func (t *teleportAuthenticator) Authenticate(r *http.Request) (*Identity, error) {
	token := r.Header.Get("Teleport-Jwt-Assertion")
	if token == "" {
		return nil, fmt.Errorf("missing Teleport-Jwt-Assertion header")
	}

	keys, err := t.cache.get()
	if err != nil {
		log.Printf("auth: failed to fetch JWKS: %v", err)
		return nil, fmt.Errorf("unable to fetch signing keys")
	}

	claims, err := parseAndVerifyJWT(token, keys)
	if err != nil {
		log.Printf("auth: JWT verification failed: %v", err)
		return nil, fmt.Errorf("invalid JWT: %v", err)
	}

	if err := validateClaims(claims, t.audience); err != nil {
		log.Printf("auth: claim validation failed: %v", err)
		return nil, fmt.Errorf("JWT claim validation failed: %v", err)
	}

	username := claims.Username
	if username == "" {
		username = claims.Subject
	}
	return &Identity{User: username, Roles: claims.Roles}, nil
}

// ── JWKS types ────────────────────────────────────────────────────────────────

type jwk struct {
	KeyType   string `json:"kty"`
	Algorithm string `json:"alg"`
	Use       string `json:"use"`
	KeyID     string `json:"kid"`
	N         string `json:"n"`
	E         string `json:"e"`
	Curve     string `json:"crv"`
	X         string `json:"x"`
	Y         string `json:"y"`
}

type jwksResponse struct {
	Keys []jwk `json:"keys"`
}

// ── JWT header / payload types ────────────────────────────────────────────────

type jwtHeader struct {
	Algorithm string `json:"alg"`
	KeyID     string `json:"kid"`
}

type jwtClaims struct {
	Issuer    string   `json:"iss"`
	Subject   string   `json:"sub"`
	Audience  audience `json:"aud"`
	ExpiresAt int64    `json:"exp"`
	NotBefore int64    `json:"nbf"`
	IssuedAt  int64    `json:"iat"`
	Username  string   `json:"username"`
	Roles     []string `json:"roles"`
}

// audience handles both string and []string JSON values.
type audience []string

func (a *audience) UnmarshalJSON(b []byte) error {
	var s string
	if err := json.Unmarshal(b, &s); err == nil {
		*a = []string{s}
		return nil
	}
	var ss []string
	if err := json.Unmarshal(b, &ss); err != nil {
		return err
	}
	*a = ss
	return nil
}

// ── Key cache ─────────────────────────────────────────────────────────────────

type keyCache struct {
	mu         sync.RWMutex
	keys       []crypto.PublicKey
	fetchedAt  time.Time
	jwksURL    string
	httpClient *http.Client
}

const keyCacheTTL = 5 * time.Minute

func newKeyCache(jwksURL string, insecure bool) *keyCache {
	tr := http.DefaultTransport.(*http.Transport).Clone()
	if insecure {
		tr.TLSClientConfig.InsecureSkipVerify = true
	}
	return &keyCache{
		jwksURL:    jwksURL,
		httpClient: &http.Client{Transport: tr, Timeout: 10 * time.Second},
	}
}

func (c *keyCache) get() ([]crypto.PublicKey, error) {
	c.mu.RLock()
	if time.Since(c.fetchedAt) < keyCacheTTL && len(c.keys) > 0 {
		keys := c.keys
		c.mu.RUnlock()
		return keys, nil
	}
	c.mu.RUnlock()

	c.mu.Lock()
	defer c.mu.Unlock()
	if time.Since(c.fetchedAt) < keyCacheTTL && len(c.keys) > 0 {
		return c.keys, nil
	}

	resp, err := c.httpClient.Get(c.jwksURL)
	if err != nil {
		return nil, fmt.Errorf("fetch JWKS: %w", err)
	}
	defer resp.Body.Close()

	var jwks jwksResponse
	if err := json.NewDecoder(resp.Body).Decode(&jwks); err != nil {
		return nil, fmt.Errorf("decode JWKS: %w", err)
	}

	var keys []crypto.PublicKey
	for _, k := range jwks.Keys {
		pub, err := parseJWK(k)
		if err != nil {
			log.Printf("auth: skipping JWK (kid=%s): %v", k.KeyID, err)
			continue
		}
		keys = append(keys, pub)
	}
	if len(keys) == 0 {
		return nil, fmt.Errorf("JWKS contained no usable keys")
	}
	c.keys = keys
	c.fetchedAt = time.Now()
	return keys, nil
}

func parseJWK(k jwk) (crypto.PublicKey, error) {
	switch k.KeyType {
	case "RSA":
		return parseRSAJWK(k)
	case "EC":
		return parseECDSAJWK(k)
	default:
		return nil, fmt.Errorf("unsupported key type %q", k.KeyType)
	}
}

func parseRSAJWK(k jwk) (*rsa.PublicKey, error) {
	nBytes, err := base64.RawURLEncoding.DecodeString(k.N)
	if err != nil {
		return nil, fmt.Errorf("decode N: %w", err)
	}
	eBytes, err := base64.RawURLEncoding.DecodeString(k.E)
	if err != nil {
		return nil, fmt.Errorf("decode E: %w", err)
	}
	return &rsa.PublicKey{
		N: new(big.Int).SetBytes(nBytes),
		E: int(new(big.Int).SetBytes(eBytes).Int64()),
	}, nil
}

func parseECDSAJWK(k jwk) (*ecdsa.PublicKey, error) {
	var curve elliptic.Curve
	switch k.Curve {
	case "P-256":
		curve = elliptic.P256()
	case "P-384":
		curve = elliptic.P384()
	case "P-521":
		curve = elliptic.P521()
	default:
		return nil, fmt.Errorf("unsupported curve %q", k.Curve)
	}
	xBytes, err := base64.RawURLEncoding.DecodeString(k.X)
	if err != nil {
		return nil, fmt.Errorf("decode X: %w", err)
	}
	yBytes, err := base64.RawURLEncoding.DecodeString(k.Y)
	if err != nil {
		return nil, fmt.Errorf("decode Y: %w", err)
	}
	return &ecdsa.PublicKey{
		Curve: curve,
		X:     new(big.Int).SetBytes(xBytes),
		Y:     new(big.Int).SetBytes(yBytes),
	}, nil
}

// ── JWT verification (stdlib only) ───────────────────────────────────────────

func parseAndVerifyJWT(token string, keys []crypto.PublicKey) (*jwtClaims, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil, fmt.Errorf("malformed JWT: expected 3 parts, got %d", len(parts))
	}

	headerJSON, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return nil, fmt.Errorf("decode header: %w", err)
	}
	var hdr jwtHeader
	if err := json.Unmarshal(headerJSON, &hdr); err != nil {
		return nil, fmt.Errorf("parse header: %w", err)
	}

	claimsJSON, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, fmt.Errorf("decode claims: %w", err)
	}
	var claims jwtClaims
	if err := json.Unmarshal(claimsJSON, &claims); err != nil {
		return nil, fmt.Errorf("parse claims: %w", err)
	}

	sig, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return nil, fmt.Errorf("decode signature: %w", err)
	}

	message := []byte(parts[0] + "." + parts[1])

	var verifyErr error
	for _, key := range keys {
		if err := verifySignature(hdr.Algorithm, key, message, sig); err == nil {
			verifyErr = nil
			break
		} else {
			verifyErr = err
		}
	}
	if verifyErr != nil {
		return nil, fmt.Errorf("signature verification failed: %w", verifyErr)
	}

	return &claims, nil
}

func verifySignature(alg string, key crypto.PublicKey, message, sig []byte) error {
	switch alg {
	case "RS256":
		return verifyRSA(key, crypto.SHA256, sha256.New(), message, sig)
	case "RS384":
		return verifyRSA(key, crypto.SHA384, sha512.New384(), message, sig)
	case "RS512":
		return verifyRSA(key, crypto.SHA512, sha512.New(), message, sig)
	case "ES256":
		return verifyECDSA(key, sha256.New(), message, sig)
	case "ES384":
		return verifyECDSA(key, sha512.New384(), message, sig)
	case "ES512":
		return verifyECDSA(key, sha512.New(), message, sig)
	default:
		return fmt.Errorf("unsupported algorithm %q", alg)
	}
}

func verifyRSA(key crypto.PublicKey, h crypto.Hash, hw hash.Hash, message, sig []byte) error {
	rsaKey, ok := key.(*rsa.PublicKey)
	if !ok {
		return fmt.Errorf("key is not RSA")
	}
	hw.Write(message)
	return rsa.VerifyPKCS1v15(rsaKey, h, hw.Sum(nil), sig)
}

func verifyECDSA(key crypto.PublicKey, hw hash.Hash, message, sig []byte) error {
	ecKey, ok := key.(*ecdsa.PublicKey)
	if !ok {
		return fmt.Errorf("key is not ECDSA")
	}
	if len(sig)%2 != 0 {
		return fmt.Errorf("invalid ECDSA signature length")
	}
	half := len(sig) / 2
	r := new(big.Int).SetBytes(sig[:half])
	s := new(big.Int).SetBytes(sig[half:])
	hw.Write(message)
	if !ecdsa.Verify(ecKey, hw.Sum(nil), r, s) {
		return fmt.Errorf("ECDSA verification failed")
	}
	return nil
}

func validateClaims(claims *jwtClaims, expectedAudience string) error {
	now := time.Now().Unix()
	if claims.ExpiresAt > 0 && now > claims.ExpiresAt {
		return fmt.Errorf("token expired")
	}
	if claims.NotBefore > 0 && now < claims.NotBefore-30 {
		return fmt.Errorf("token not yet valid")
	}
	if expectedAudience != "" {
		found := false
		for _, a := range claims.Audience {
			if a == expectedAudience {
				found = true
				break
			}
		}
		if !found {
			return fmt.Errorf("audience %q not in token audiences %v", expectedAudience, []string(claims.Audience))
		}
	}
	return nil
}
