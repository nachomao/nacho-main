#!/usr/bin/env bash
set -euo pipefail

backup=/opt/control-server-backups/uninstall-zero-residue-20260831T085300Z/uninstall.ps1
target=/opt/control-server/deploy/windows/uninstall.ps1
expected=93bd1d8c5641306d7c86af4284ea50f1313d6c31286ae12192803e5a15fd0e8e
backup_root=/opt/control-server-backups/uninstall-zero-residue-20260831T085300Z

test "$(sha256sum "$backup" | awk '{print $1}')" = "$expected"
install -o control -g control -m 0777 "$backup" "$target"
for relative in src/services/clients.ts src/routes/agent.ts dist/services/clients.js dist/routes/agent.js; do
  install -o control -g control -m 0777 "$backup_root/$relative" "/opt/control-server/$relative"
done
test "$(sha256sum "$target" | awk '{print $1}')" = "$expected"
systemctl restart control-server.service
for _ in {1..15}; do
  curl -fsS -o /dev/null http://localhost:8443/health && break
  sleep 1
done
curl -fsS -o /dev/null http://localhost:8443/health
echo "server rollback output: restored=$target; sha256=$expected"
echo 'server rollback output: source/dist restored; service=active; health=200'
echo 'server rollback exit: 0'
