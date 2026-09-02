#!/usr/bin/env bash
set -euo pipefail
INSTALL_DIR=/opt/control-server
BACKUP_SUFFIX=20260831
cp "$INSTALL_DIR/src/services/clients.ts.bak-$BACKUP_SUFFIX" "$INSTALL_DIR/src/services/clients.ts"
cp "$INSTALL_DIR/src/routes/agent.ts.bak-$BACKUP_SUFFIX" "$INSTALL_DIR/src/routes/agent.ts"
cp "$INSTALL_DIR/dist/services/clients.js.bak-$BACKUP_SUFFIX" "$INSTALL_DIR/dist/services/clients.js"
cp "$INSTALL_DIR/dist/routes/agent.js.bak-$BACKUP_SUFFIX" "$INSTALL_DIR/dist/routes/agent.js"
systemctl restart control-server.service
systemctl is-active control-server.service
