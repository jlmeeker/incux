#!/usr/bin/env bash
# deploy.sh — build and deploy IncUX to a remote server.
#
# Usage:
#   ./deploy/deploy.sh [user@]host
#
# Environment overrides:
#   DEPLOY_HOST   — SSH target (default: first positional arg, or required)
#   DEPLOY_USER   — SSH login user (default: current user)
#   REMOTE_USER   — system account that runs the service (default: incux)
#   REMOTE_DIR    — working / data directory on the remote (default: /var/lib/incux)
#   BINARY_SRC    — local path to the compiled binary (default: ./dist/incux)
#   SERVICE_SRC   — local path to the service file (default: ./deploy/incux.service)
#   SERVICE_NAME  — systemd unit name (default: incux)
#   INSTALL_BIN   — path on the remote where the binary is installed (default: /usr/local/bin/incux)

set -euo pipefail

# ── Configuration ─────────────────────────────────────────────────────────────

DEPLOY_HOST="${DEPLOY_HOST:-${1:-}}"
if [[ -z "$DEPLOY_HOST" ]]; then
  echo "error: no deploy host specified." >&2
  echo "usage: $0 [user@]host" >&2
  exit 1
fi

DEPLOY_USER="${DEPLOY_USER:-}"   # empty = use SSH default (current user / ~/.ssh/config)
REMOTE_USER="${REMOTE_USER:-incux}"
REMOTE_DIR="${REMOTE_DIR:-/var/lib/incux}"
BINARY_SRC="${BINARY_SRC:-./dist/incux}"
SERVICE_SRC="${SERVICE_SRC:-./deploy/incux.service}"
SERVICE_NAME="${SERVICE_NAME:-incux}"
INSTALL_BIN="${INSTALL_BIN:-/usr/local/bin/incux}"

SSH_TARGET="${DEPLOY_USER:+${DEPLOY_USER}@}${DEPLOY_HOST}"
SSH="ssh ${SSH_TARGET}"
SCP="scp"

# ── Pre-flight ────────────────────────────────────────────────────────────────

if [[ ! -f "$BINARY_SRC" ]]; then
  echo "error: binary not found at '$BINARY_SRC' — run 'make all' first." >&2
  exit 1
fi

if [[ ! -f "$SERVICE_SRC" ]]; then
  echo "error: service file not found at '$SERVICE_SRC'." >&2
  exit 1
fi

echo "==> Deploying IncUX to ${SSH_TARGET}"
echo "    binary:  ${BINARY_SRC}"
echo "    service: ${SERVICE_SRC} -> /etc/systemd/system/${SERVICE_NAME}.service"
echo "    install: ${INSTALL_BIN}"
echo "    runuser: ${REMOTE_USER}  workdir: ${REMOTE_DIR}"
echo

# ── Copy files ────────────────────────────────────────────────────────────────

echo "--> Copying binary..."
$SCP "$BINARY_SRC" "${SSH_TARGET}:/tmp/incux.bin"

echo "--> Copying service file..."
$SCP "$SERVICE_SRC" "${SSH_TARGET}:/tmp/${SERVICE_NAME}.service"

# ── Remote provisioning ───────────────────────────────────────────────────────

echo "--> Provisioning on remote..."
$SSH bash -s <<REMOTE
set -euo pipefail

# Create system account if it doesn't exist
if ! id "${REMOTE_USER}" &>/dev/null; then
  echo "  creating system user '${REMOTE_USER}'..."
  sudo useradd \
    --system \
    --home-dir "${REMOTE_DIR}" \
    --create-home \
    --shell /usr/sbin/nologin \
    --comment "IncUX service account" \
    "${REMOTE_USER}"
else
  # User exists — ensure home dir is set correctly and exists.
  sudo usermod --home "${REMOTE_DIR}" "${REMOTE_USER}"
  if [[ ! -d "${REMOTE_DIR}" ]]; then
    echo "  creating ${REMOTE_DIR}..."
    sudo mkdir -p "${REMOTE_DIR}"
  fi
fi
sudo chown "${REMOTE_USER}:${REMOTE_USER}" "${REMOTE_DIR}"
sudo chmod 750 "${REMOTE_DIR}"

# Install binary
echo "  installing binary to ${INSTALL_BIN}..."
sudo install -o root -g root -m 755 /tmp/incux.bin "${INSTALL_BIN}"
rm -f /tmp/incux.bin

# Install service file
echo "  installing service file..."
sudo install -o root -g root -m 644 /tmp/${SERVICE_NAME}.service \
  /etc/systemd/system/${SERVICE_NAME}.service
rm -f /tmp/${SERVICE_NAME}.service

# Reload systemd to pick up any changes to the unit file
echo "  reloading systemd daemon..."
sudo systemctl daemon-reload

# Enable the service so it starts on boot
echo "  enabling ${SERVICE_NAME}..."
sudo systemctl enable "${SERVICE_NAME}"

# Restart (or start if not yet running)
echo "  restarting ${SERVICE_NAME}..."
sudo systemctl restart "${SERVICE_NAME}"

# Brief pause then show status
sleep 1
sudo systemctl status "${SERVICE_NAME}" --no-pager --lines=10

REMOTE

echo
echo "==> Done. IncUX is running on ${SSH_TARGET} (listening on 127.0.0.1:8080 by default)."
echo
echo "    To get a shell as the service account:"
echo "      sudo su -s /bin/bash - incux"
echo "    or:"
echo "      sudo -u incux -s /bin/bash"
