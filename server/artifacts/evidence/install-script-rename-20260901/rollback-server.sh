#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/control-server}"
BACKUP="${BACKUP:-/opt/control-server/deploy/windows/install.ps1.bak-rename-20260901031729}"

test -f "$BACKUP"
cp "$BACKUP" "$INSTALL_DIR/deploy/windows/install.ps1"
rm -f "$INSTALL_DIR/deploy/windows/nacho.ps1"
sed -i 's/nacho\.ps1/install.ps1/g' "$INSTALL_DIR/src/routes/artifacts.ts" "$INSTALL_DIR/dist/routes/artifacts.js"
chown control:control "$INSTALL_DIR/deploy/windows/install.ps1" "$INSTALL_DIR/src/routes/artifacts.ts" "$INSTALL_DIR/dist/routes/artifacts.js"
systemctl restart control-server.service
curl -fsS -o /dev/null "http://localhost:8443/install.ps1"
test "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:8443/nacho.ps1)" = "404"
