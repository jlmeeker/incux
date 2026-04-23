package main

import (
	"bufio"
	"context"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strings"
	"time"
)

// incusProxy returns an http.Handler that reverse-proxies the request to the
// configured Incus upstream.  WebSocket upgrade requests are tunnelled via raw
// TCP so that hop-by-hop headers (Upgrade, Connection) are preserved.
func incusProxy(stripPrefix string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		addr := incusAddr()

		// Strip the leading prefix so Incus sees its own path layout.
		r.URL.Path = strings.TrimPrefix(r.URL.Path, stripPrefix)
		if r.URL.Path == "" {
			r.URL.Path = "/"
		}

		isWS := strings.EqualFold(r.Header.Get("Upgrade"), "websocket")

		switch {
		case strings.HasPrefix(addr, "http://") || strings.HasPrefix(addr, "https://"):
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
			http.Error(w, "unsupported INCUS_ADDR scheme", http.StatusBadGateway)
		}
	})
}

// incusAddr returns the upstream Incus address from the environment.
func incusAddr() string {
	if v := os.Getenv("INCUS_ADDR"); v != "" {
		return v
	}
	return "unix:///var/lib/incus/unix.socket"
}

// ── Regular HTTP reverse proxy ───────────────────────────────────────────────

func proxyHTTP(addr string, w http.ResponseWriter, r *http.Request) {
	target, err := url.Parse(addr)
	if err != nil {
		http.Error(w, "invalid INCUS_ADDR", http.StatusBadGateway)
		return
	}
	rp := httputil.NewSingleHostReverseProxy(target)
	rp.FlushInterval = -1
	rp.ErrorHandler = func(rw http.ResponseWriter, req *http.Request, err error) {
		log.Printf("proxy error: %v", err)
		http.Error(rw, "upstream error", http.StatusBadGateway)
	}
	rp.ServeHTTP(w, r)
}

func proxyUnix(socketPath string, w http.ResponseWriter, r *http.Request) {
	if socketPath == "" {
		http.Error(w, "invalid unix socket path", http.StatusBadGateway)
		return
	}
	target := &url.URL{Scheme: "http", Host: "incus"}
	rp := &httputil.ReverseProxy{
		Director: func(req *http.Request) {
			req.URL.Scheme = target.Scheme
			req.URL.Host = target.Host
			req.Host = "localhost"
		},
		Transport: &http.Transport{
			DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
				return (&net.Dialer{Timeout: 30 * time.Second}).DialContext(ctx, "unix", socketPath)
			},
			DisableCompression: true,
		},
		FlushInterval: -1,
		ErrorHandler: func(rw http.ResponseWriter, req *http.Request, err error) {
			log.Printf("proxy unix error: %v", err)
			http.Error(rw, "upstream error", http.StatusBadGateway)
		},
	}
	rp.ServeHTTP(w, r)
}

// ── WebSocket tunnel (raw TCP, preserves Upgrade/Connection headers) ─────────

// tunnelUnix dials the Incus unix socket and splices the raw HTTP/WebSocket
// bytes in both directions.  This bypasses httputil.ReverseProxy so that
// hop-by-hop headers (Upgrade, Connection) are forwarded intact.
func tunnelUnix(socketPath string, w http.ResponseWriter, r *http.Request) {
	upstream, err := net.DialTimeout("unix", socketPath, 10*time.Second)
	if err != nil {
		log.Printf("tunnel unix dial error: %v", err)
		http.Error(w, "upstream dial error", http.StatusBadGateway)
		return
	}
	tunnel(upstream, w, r)
}

// tunnelHTTP dials a TCP upstream and splices bytes in both directions.
func tunnelHTTP(addr string, w http.ResponseWriter, r *http.Request) {
	u, err := url.Parse(addr)
	if err != nil {
		http.Error(w, "invalid INCUS_ADDR", http.StatusBadGateway)
		return
	}
	host := u.Host
	if !strings.Contains(host, ":") {
		if u.Scheme == "https" {
			host += ":443"
		} else {
			host += ":80"
		}
	}
	upstream, err := net.DialTimeout("tcp", host, 10*time.Second)
	if err != nil {
		log.Printf("tunnel http dial error: %v", err)
		http.Error(w, "upstream dial error", http.StatusBadGateway)
		return
	}
	tunnel(upstream, w, r)
}

// tunnel hijacks the client connection and splices it to the already-open
// upstream conn, forwarding the current request first.
func tunnel(upstream net.Conn, w http.ResponseWriter, r *http.Request) {
	defer upstream.Close()

	// Hijack the client connection so we can access the raw TCP stream.
	hj, ok := w.(http.Hijacker)
	if !ok {
		http.Error(w, "webSocket tunnel: hijack not supported", http.StatusInternalServerError)
		return
	}
	clientConn, buf, err := hj.Hijack()
	if err != nil {
		log.Printf("tunnel hijack error: %v", err)
		return
	}
	defer clientConn.Close()

	// Forward the original HTTP request (with all its headers) to the upstream.
	if err := r.Write(upstream); err != nil {
		log.Printf("tunnel write request error: %v", err)
		return
	}

	// Flush any bytes already buffered from the client.
	if buf.Reader.Buffered() > 0 {
		data := make([]byte, buf.Reader.Buffered())
		buf.Read(data)
		upstream.Write(data)
	}

	// Read the upstream 101 response so we can inspect and patch it before
	// forwarding to the browser.  The browser requires that if it sent
	// Sec-WebSocket-Protocol, the server echoes it back — Incus doesn't, so
	// we inject the header ourselves.
	upstreamReader := bufio.NewReader(upstream)
	resp, err := http.ReadResponse(upstreamReader, r)
	if err != nil {
		log.Printf("tunnel read upstream response error: %v", err)
		return
	}

	requestedProto := r.Header.Get("Sec-Websocket-Protocol")
	if requestedProto == "" {
		requestedProto = r.Header.Get("Sec-WebSocket-Protocol")
	}
	if requestedProto != "" && resp.Header.Get("Sec-Websocket-Protocol") == "" {
		resp.Header.Set("Sec-Websocket-Protocol", requestedProto)
	}

	// Write the (possibly patched) response back to the client.
	if err := resp.Write(clientConn); err != nil {
		log.Printf("tunnel write response error: %v", err)
		return
	}

	// Drain anything already buffered from the upstream into the splice.
	// Then splice upstream ↔ client for the rest of the WebSocket session.
	done := make(chan struct{}, 2)
	go func() {
		io.Copy(upstream, clientConn)
		done <- struct{}{}
	}()
	go func() {
		// First drain any bytes already read into upstreamReader's buffer.
		io.Copy(clientConn, upstreamReader)
		done <- struct{}{}
	}()
	<-done
}
