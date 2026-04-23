# Makefile for building and running Incux

# Detect OS/ARCH for compilation
OS := $(shell uname -s | tr '[:upper:]' '[:lower:]')
# Normalize common uname -m outputs to Go GOARCH values
# x86_64 -> amd64, aarch64 -> arm64; leave others unchanged
ARCH := $(shell uname -m | sed -e 's/x86_64/amd64/' -e 's/aarch64/arm64/')
DIST_DIR := ./dist
WEB_DIR   := ./web

.PHONY: all build-backend build-frontend test test-backend test-frontend run clean

all: build-frontend build-backend
	@echo "Build complete. Binary is in $(DIST_DIR)"

# Build the Go binary. The assets.go embed file at the repo root references
# web/dist, so the frontend must be built first.
build-backend:
	@mkdir -p $(DIST_DIR)
	GOOS=$(OS) GOARCH=$(ARCH) CGO_ENABLED=0 go build -o $(DIST_DIR)/incux ./cmd/incux

# Build the frontend (output goes to web/dist/ for Go embed)
build-frontend:
	cd $(WEB_DIR) && npm install && npm run build

# Run the resulting binary
run: all
	$(DIST_DIR)/incux

# Run all tests
test: test-backend test-frontend

test-backend:
	go test ./...

test-frontend:
	cd $(WEB_DIR) && npm test

# Clean up build artifacts
clean:
	rm -rf $(DIST_DIR)
	rm -rf $(WEB_DIR)/dist
