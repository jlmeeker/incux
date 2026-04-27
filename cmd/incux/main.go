package main

import (
	"log"
	"net/http"
	"os"

	assets "incux"
)

func main() {
	auth := newAuthenticator()
	frontend := assets.Frontend()

	mux := http.NewServeMux()
	registerRoutes(mux, frontend, auth)
	startHealthChecker()

	addr := os.Getenv("INCUX_LISTEN")
	if addr == "" {
		addr = ":8080"
	}
	log.Printf("starting IncUX on %s  (Incus upstream: %s)", addr, incusAddr())

	// Optional internal listener with no authentication — intended for trusted
	// local services. Set INCUX_INTERNAL_LISTEN (e.g. 127.0.0.1:8081).
	if internalAddr := os.Getenv("INCUX_INTERNAL_LISTEN"); internalAddr != "" {
		internalMux := http.NewServeMux()
		registerRoutes(internalMux, frontend, nil)
		log.Printf("starting IncUX internal (no-auth) listener on %s", internalAddr)
		go func() {
			if err := http.ListenAndServe(internalAddr, internalMux); err != nil {
				log.Fatalf("internal server failed: %v", err)
			}
		}()
	}

	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatalf("server failed: %v", err)
	}
}
