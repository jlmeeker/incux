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

	addr := os.Getenv("INCUX_LISTEN")
	if addr == "" {
		addr = ":8080"
	}
	log.Printf("starting Incux on %s  (Incus upstream: %s)", addr, incusAddr())
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatalf("server failed: %v", err)
	}
}
