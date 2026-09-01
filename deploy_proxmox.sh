#!/bin/bash
set -e

echo "Vastleggen git-commit voor versie-badge..."
git rev-parse --short HEAD | xargs -I{} printf '{\n  "sha": "%s"\n}\n' {} > src/lib/gitSha.generated.json

echo "Inpakken lokaal..."
tar --format=ustar --no-xattrs --exclude "._*" --exclude ".DS_Store" --exclude "node_modules" --exclude ".next" --exclude "data" --exclude "companion-data" --exclude "config/qlcplus/config" --exclude ".git" --exclude "deploy.tar.gz" -czf deploy.tar.gz .

echo "Terugzetten placeholder (repo blijft schoon)..."
git checkout -- src/lib/gitSha.generated.json

echo "Kopiëren naar Proxmox..."
scp -o StrictHostKeyChecking=no deploy.tar.gz root@192.168.2.200:/root/deploy.tar.gz

echo "Deployen binnen LXC 112..."
ssh -o StrictHostKeyChecking=no root@192.168.2.200 << 'PROXMOX'
  echo "Bestand pushen naar LXC..."
  pct push 112 /root/deploy.tar.gz /mnt/data/docker/ark-livestream-manager/deploy.tar.gz
  pct exec 112 -- sh -c "cd /mnt/data/docker/ark-livestream-manager && tar -xzf deploy.tar.gz && rm deploy.tar.gz"
  pct exec 112 -- sh -c "cd /mnt/data/docker/ark-livestream-manager && chown -R 101001:101001 . || true"
  pct exec 112 -- sh -c "cd /mnt/data/docker/ark-livestream-manager && docker compose up -d --build livestream-manager qlcplus tuya-control"
PROXMOX

echo "Deployment naar Proxmox succesvol!"
rm deploy.tar.gz
