package main

import (
	"log"
	"net/http"
	"os"

	assets "incux"
)

func main() {
	mux := http.NewServeMux()
	registerRoutes(mux, assets.Frontend())
	startHealthChecker()

	addr := os.Getenv("INCUX_LISTEN")
	if addr == "" {
		addr = ":8080"
	}
	log.Printf("starting IncUX on %s  (Incus upstream: %s)", addr, incusAddr())
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatalf("server failed: %v", err)
	}
}
