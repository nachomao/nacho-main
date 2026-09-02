#!/usr/bin/env bash
set -euo pipefail
cp /opt/control-server/dist/services/clients.js.bak-20260901 /opt/control-server/dist/services/clients.js
cp /opt/control-server/dist/routes/agent.js.bak-20260901 /opt/control-server/dist/routes/agent.js
systemctl restart control-server.service
systemctl is-active control-server.service
