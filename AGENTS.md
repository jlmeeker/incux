# AGENTS.md

This file outlines instructions for building and running the Incux project, as well as the development guidelines discussed so far.

## Project Overview
**Incux** is a web UI for managing Incus environments, featuring both a backend (written in Go) and a frontend (using SolidJS). The backend binary serves the website and proxies REST communications with Incus.

### Key Objectives:
1. Build a backend Go binary that serves the web UI.
2. Create a frontend with SolidJS, supporting light and dark themes.
3. Deliver a self-contained solution where the backend handles all API communications with Incus.
4. The compiled artifacts (frontend and backend) should be placed in `./dist/` for different platforms.
5. Provide a Makefile for easier builds and execution.
6. Keep README.md and AGENTS.md up-to-date.

---

## Instructions Recap

### Tech Stack:
- **Backend (Go):** 
  - Handles API communication with Incus.
  - Embeds the frontend `dist/` content using Go's `embed` package.
  - Serves both the web UI and APIs.
  - Builds as a fully static binary.

- **Frontend (SolidJS):**
  - Built using Vite for modern development.
  - Implements a dashboard.
  - Supports light/dark themes using CSS and a toggle button.

- **Deployment:**
  - Both frontend and backend are compiled into a single distributable binary for ease of use.

### Makefile Objectives:
1. Compile the Go backend as a static binary.
2. Build the frontend and copy its artifacts into the `./dist/` directory.
3. Provide commands for running and cleaning up the project.
4. Output compiled files into `./dist/<os>-<arch>`.
5. ALL builds (even if quick or temporary) MUST use the Makefile.  Updated it if build targets are missing.  DO NOT RUN `go build` or similar commands directly.

---

## Makefile Summary
A `Makefile` has been created with the following targets:

### Build Targets:
1. `all`:
    - Builds both the backend and frontend.
    - Outputs compiled binaries into `./dist/<os>-<arch>`.

2. `build-backend`:
    - Builds the Go backend as a static binary from the repo root.
    - The binary is output to `./dist/<os>-<arch>`.

3. `build-frontend`:
    - Installs frontend dependencies.
    - Compiles the SolidJS app.
    - Places build output into `./dist/<os>-<arch>/frontend`.

### Utility Targets:
1. `run`:
    - Runs the backend binary directly.

2. `clean`:
    - Removes the `./dist/` directory and all build artifacts.

---

## Directory Structure
```
/
├── main.go        # Go backend entry point
├── routes.go      # Backend routing logic
├── proxy.go       # Reverse proxy logic
├── intercept.go   # Image alias resolution
├── logger.go      # Logging middleware
├── auth.go        # Authentication logic
├── rbac.go        # RBAC middleware
├── whoami.go      # Authenticated user endpoint
├── remotes.go     # Remote handling logic
├── auth_test.go   # Tests for authentication logic
├── rbac_test.go   # Tests for RBAC middleware
├── frontend/      # SolidJS frontend source code
│   ├── src/api.test.ts  # Frontend API utility tests
├── dist/          # Build output directory
│   └── <os>-<arch>/
│       ├── frontend/       # Compiled frontend assets
│       └── incux # Compiled backend binary
├── Makefile       # For build automation
└── AGENTS.md      # You are here!
```

---

## Next Steps:
- All backend API endpoints for Incus communication have been implemented.
- The SolidJS frontend dashboard is complete.
- Full-stack integration has been tested successfully.
- Comprehensive tests for both backend and frontend are in place.
- The project is production-ready. Use `make all` to build, `make run` to execute, and `make test` to verify functionality.

These notes summarize your instructions and tasks so far. Feel free to modify or expand based on project evolution.
