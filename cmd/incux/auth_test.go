package main

import (
	"crypto"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

// ── helpers ───────────────────────────────────────────────────────────────────

// buildJWT constructs a minimal signed JWT using an ECDSA P-256 key.
func buildJWT(t *testing.T, key *ecdsa.PrivateKey, claims jwtClaims) string {
	t.Helper()

	header := map[string]string{"alg": "ES256", "typ": "JWT"}
	hJSON, _ := json.Marshal(header)
	cJSON, _ := json.Marshal(claims)

	h64 := base64.RawURLEncoding.EncodeToString(hJSON)
	c64 := base64.RawURLEncoding.EncodeToString(cJSON)
	msg := h64 + "." + c64

	hash := sha256.Sum256([]byte(msg))
	r, s, err := ecdsa.Sign(rand.Reader, key, hash[:])
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	// ECDSA signature is r||s, each padded to 32 bytes for P-256.
	rb := r.Bytes()
	sb := s.Bytes()
	pad := func(b []byte, n int) []byte {
		if len(b) >= n {
			return b
		}
		out := make([]byte, n)
		copy(out[n-len(b):], b)
		return out
	}
	sig := append(pad(rb, 32), pad(sb, 32)...)
	return msg + "." + base64.RawURLEncoding.EncodeToString(sig)
}

func newTestKey(t *testing.T) *ecdsa.PrivateKey {
	t.Helper()
	k, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	return k
}

// ── audience UnmarshalJSON ────────────────────────────────────────────────────

func TestAudienceUnmarshal(t *testing.T) {
	t.Run("string", func(t *testing.T) {
		var a audience
		if err := json.Unmarshal([]byte(`"example.com"`), &a); err != nil {
			t.Fatal(err)
		}
		if len(a) != 1 || a[0] != "example.com" {
			t.Errorf("got %v", a)
		}
	})
	t.Run("array", func(t *testing.T) {
		var a audience
		if err := json.Unmarshal([]byte(`["a","b"]`), &a); err != nil {
			t.Fatal(err)
		}
		if len(a) != 2 {
			t.Errorf("got %v", a)
		}
	})
}

// ── validateClaims ────────────────────────────────────────────────────────────

func TestValidateClaims(t *testing.T) {
	now := time.Now().Unix()

	t.Run("valid", func(t *testing.T) {
		c := &jwtClaims{ExpiresAt: now + 3600, NotBefore: now - 10, Audience: audience{"aud"}}
		if err := validateClaims(c, "aud"); err != nil {
			t.Errorf("unexpected error: %v", err)
		}
	})

	t.Run("expired", func(t *testing.T) {
		c := &jwtClaims{ExpiresAt: now - 1}
		if err := validateClaims(c, ""); err == nil {
			t.Error("expected expired error")
		}
	})

	t.Run("not yet valid", func(t *testing.T) {
		c := &jwtClaims{NotBefore: now + 600}
		if err := validateClaims(c, ""); err == nil {
			t.Error("expected nbf error")
		}
	})

	t.Run("wrong audience", func(t *testing.T) {
		c := &jwtClaims{Audience: audience{"other"}}
		if err := validateClaims(c, "expected"); err == nil {
			t.Error("expected audience error")
		}
	})

	t.Run("audience not required", func(t *testing.T) {
		c := &jwtClaims{}
		if err := validateClaims(c, ""); err != nil {
			t.Errorf("unexpected error: %v", err)
		}
	})
}

// ── parseAndVerifyJWT ─────────────────────────────────────────────────────────

func TestParseAndVerifyJWT(t *testing.T) {
	key := newTestKey(t)
	now := time.Now().Unix()

	t.Run("valid JWT", func(t *testing.T) {
		claims := jwtClaims{
			Subject:   "alice",
			Username:  "alice",
			Roles:     []string{"admin"},
			ExpiresAt: now + 3600,
			IssuedAt:  now,
		}
		token := buildJWT(t, key, claims)
		got, err := parseAndVerifyJWT(token, []crypto.PublicKey{&key.PublicKey})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if got.Username != "alice" {
			t.Errorf("username = %q, want alice", got.Username)
		}
		if len(got.Roles) != 1 || got.Roles[0] != "admin" {
			t.Errorf("roles = %v, want [admin]", got.Roles)
		}
	})

	t.Run("wrong key rejected", func(t *testing.T) {
		other := newTestKey(t)
		claims := jwtClaims{ExpiresAt: now + 3600}
		token := buildJWT(t, key, claims)
		_, err := parseAndVerifyJWT(token, []crypto.PublicKey{&other.PublicKey})
		if err == nil {
			t.Error("expected signature error")
		}
	})

	t.Run("malformed token", func(t *testing.T) {
		_, err := parseAndVerifyJWT("not.a.jwt.at.all", []crypto.PublicKey{&key.PublicKey})
		if err == nil {
			t.Error("expected parse error")
		}
	})

	t.Run("tampered payload", func(t *testing.T) {
		claims := jwtClaims{ExpiresAt: now + 3600, Roles: []string{"viewer"}}
		token := buildJWT(t, key, claims)

		// Replace the payload part with a different base64 blob.
		parts := strings.Split(token, ".")
		tampered := jwtClaims{Roles: []string{"admin"}}
		tb, _ := json.Marshal(tampered)
		parts[1] = base64.RawURLEncoding.EncodeToString(tb)
		_, err := parseAndVerifyJWT(strings.Join(parts, "."), []crypto.PublicKey{&key.PublicKey})
		if err == nil {
			t.Error("expected signature error for tampered payload")
		}
	})

	t.Run("key rotation — second key matches", func(t *testing.T) {
		old := newTestKey(t)
		claims := jwtClaims{ExpiresAt: now + 3600}
		token := buildJWT(t, key, claims)
		// old key is listed first, signing key second — should still verify.
		_, err := parseAndVerifyJWT(token, []crypto.PublicKey{&old.PublicKey, &key.PublicKey})
		if err != nil {
			t.Errorf("unexpected error with key rotation: %v", err)
		}
	})
}

// ── verifyECDSA signature length guard ───────────────────────────────────────

func TestVerifyECDSA_OddLengthSig(t *testing.T) {
	key := newTestKey(t)
	msg := []byte("test message")
	h := sha256.New()
	h.Write(msg)
	// Odd-length signature must be rejected.
	err := verifyECDSA(&key.PublicKey, sha256.New(), msg, []byte{0x01, 0x02, 0x03})
	if err == nil {
		t.Error("expected error for odd-length ECDSA signature")
	}
}

// ── parseJWK ──────────────────────────────────────────────────────────────────

func TestParseJWK_UnsupportedKeyType(t *testing.T) {
	_, err := parseJWK(jwk{KeyType: "oct"})
	if err == nil {
		t.Error("expected error for unsupported key type")
	}
}

func TestParseJWK_UnsupportedCurve(t *testing.T) {
	_, err := parseJWK(jwk{KeyType: "EC", Curve: "P-999"})
	if err == nil {
		t.Error("expected error for unsupported curve")
	}
}

func TestParseJWK_EC(t *testing.T) {
	key := newTestKey(t)
	pub := &key.PublicKey

	xb := make([]byte, 32)
	yb := make([]byte, 32)
	pub.X.FillBytes(xb)
	pub.Y.FillBytes(yb)

	j := jwk{
		KeyType: "EC",
		Curve:   "P-256",
		X:       base64.RawURLEncoding.EncodeToString(xb),
		Y:       base64.RawURLEncoding.EncodeToString(yb),
	}
	got, err := parseJWK(j)
	if err != nil {
		t.Fatalf("parseJWK: %v", err)
	}
	parsed := got.(*ecdsa.PublicKey)
	if parsed.X.Cmp(pub.X) != 0 || parsed.Y.Cmp(pub.Y) != 0 {
		t.Error("parsed public key coordinates do not match")
	}
}

func TestParseJWK_RSA_BadBase64(t *testing.T) {
	_, err := parseJWK(jwk{KeyType: "RSA", N: "!!!bad", E: "AQAB"})
	if err == nil {
		t.Error("expected error for bad base64 in N")
	}
}
