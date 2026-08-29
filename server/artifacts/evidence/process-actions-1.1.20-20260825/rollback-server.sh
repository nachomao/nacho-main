#!/usr/bin/env bash
set -euo pipefail
runtime=/opt/control-server
backup=/opt/control-server/backups/process-actions-1.1.20-20260825-174036
test "$(readlink -f "$runtime")" = /opt/control-server
test "$(readlink -f "$backup")" = /opt/control-server/backups/process-actions-1.1.20-20260825-174036
test -d "$backup/dist"
test -f "$backup/latest.json"
if [[ "${1:-}" == --verify ]]; then echo SERVER_ROLLBACK_VERIFY_OK; exit 0; fi
systemctl stop control-server.service
rm -rf -- "$runtime/dist.rollback-new"
mv "$runtime/dist" "$runtime/dist.rollback-new"
cp -a "$backup/dist" "$runtime/dist"
cp "$backup/latest.json" "$runtime/artifacts/windows/latest.json"
chown -R control:control "$runtime/dist" "$runtime/artifacts/windows/latest.json"
systemctl start control-server.service
curl -fsS http://localhost:8443/health
rm -rf -- "$runtime/dist.rollback-new"
