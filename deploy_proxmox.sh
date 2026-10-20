#!/bin/bash
# Deploy naar de testomgeving (Proxmox, LXC 112).
# Na het uitpakken wordt van elk bestand de checksum vergeleken met wat lokaal is ingepakt. Een bestand dat niet goed is
# aangekomen (dat gebeurde eerder zonder melding) wordt apart opnieuw overgezet; lukt dat niet, dan stopt de deploy vóór het bouwen.
set -e

HOST=root@192.168.2.200
CT=112
APP=/mnt/data/docker/ark-livestream-manager
SSH="ssh -o StrictHostKeyChecking=no -o ServerAliveInterval=15 -o ServerAliveCountMax=8"

echo "Vastleggen git-commit voor versie-badge..."
git rev-parse --short HEAD | xargs -I{} printf '{\n  "sha": "%s"\n}\n' {} > src/lib/gitSha.generated.json

echo "Inpakken lokaal..."
tar --format=ustar --no-xattrs --exclude "._*" --exclude ".DS_Store" --exclude "node_modules" --exclude ".next" --exclude "data" --exclude "companion-data" --exclude "config/qlcplus/config" --exclude ".git" --exclude "deploy.tar.gz" --exclude "deploy.manifest" --exclude "track-computer/ark-engine/target" --exclude "track-computer/ark-desktop/build" --exclude "__pycache__" --exclude ".claude" --exclude "./freeshow" -czf deploy.tar.gz .

echo "Terugzetten placeholder (repo blijft schoon)..."
git checkout -- src/lib/gitSha.generated.json

echo "Controlelijst maken (checksum per bestand)..."
python3 - <<'PY' > deploy.manifest
import hashlib, tarfile
with tarfile.open("deploy.tar.gz") as t:
    for m in t:
        if m.isfile():
            print(f"{hashlib.md5(t.extractfile(m).read()).hexdigest()}  {m.name}")
PY
echo "  $(wc -l < deploy.manifest | tr -d ' ') bestanden in de lijst"

echo "Kopiëren naar Proxmox..."
scp -o StrictHostKeyChecking=no deploy.tar.gz deploy.manifest $HOST:/root/

echo "Uitpakken binnen LXC $CT..."
$SSH $HOST "pct push $CT /root/deploy.tar.gz $APP/deploy.tar.gz && pct push $CT /root/deploy.manifest $APP/.deploy-manifest && pct exec $CT -- sh -c 'cd $APP && tar --no-same-owner --no-overwrite-dir -m -xzf deploy.tar.gz 2>&1 | tail -3; rm -f deploy.tar.gz; (chown -R 101001:101001 . || true)'"

verifieer() {
  # geeft de mislukte bestanden terug, één per regel (leeg = alles goed)
  $SSH $HOST "pct exec $CT -- sh -c 'cd $APP && md5sum -c .deploy-manifest 2>/dev/null | grep -v \": OK\$\" || true'" | sed 's/: .*$//'
}

echo "Controleren of alle bestanden goed zijn aangekomen..."
FOUT=$(verifieer)
if [ -n "$FOUT" ]; then
  echo "Niet goed aangekomen, opnieuw overzetten:"
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    rel="${f#./}"
    echo "  - $rel"
    # stdin van de lus niet laten opeten door scp/ssh (anders wordt alleen het eerste bestand hersteld)
    scp -q -o StrictHostKeyChecking=no "./$rel" $HOST:/root/deploy.fix < /dev/null
    $SSH -n $HOST "pct exec $CT -- rm -f '$APP/$rel' && pct push $CT /root/deploy.fix '$APP/$rel' && rm -f /root/deploy.fix"
  done <<< "$FOUT"
  FOUT=$(verifieer)
  if [ -n "$FOUT" ]; then
    echo "FOUT: deze bestanden zijn nog steeds niet gelijk aan de lokale versie, deploy gestopt:"
    echo "$FOUT"
    rm -f deploy.tar.gz deploy.manifest
    exit 1
  fi
fi
echo "Alle bestanden komen overeen."

echo "Bouwen en starten..."
$SSH $HOST "pct exec $CT -- sh -c 'cd $APP && docker compose up -d --build livestream-manager qlcplus tuya-control'"

echo "Deployment naar Proxmox succesvol!"
rm -f deploy.tar.gz deploy.manifest
