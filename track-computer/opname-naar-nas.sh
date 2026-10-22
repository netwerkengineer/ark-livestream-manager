#!/bin/bash
# Kopieert een opname-map van de track-computer naar de NAS (SMB-share) en controleert het resultaat.
# Wordt na "Stop opname" gestart door ark_tracks_bridge.lua (en door de knop "Kopieer naar de NAS" in de app).
# Verwijdert NOOIT iets op de track-computer. De voortgang staat in <opname-map>/.naar-nas.status.
#
# Gebruik: opname-naar-nas.sh <opname-map>
# Instellingen: ~/Tracks/_tools/opname-nas.conf (zie opname-nas.conf.example)
set -u
SRC="${1:-}"
CONF="${ARK_OPNAME_CONF:-$HOME/Tracks/_tools/opname-nas.conf}"

[ -n "$SRC" ] && [ -d "$SRC" ] || { echo "Geen map: '$SRC'" >&2; exit 2; }
SRC="${SRC%/}"
STATUS="$SRC/.naar-nas.status"

schrijf() {   # status, melding, bytes, bestanden
  printf 'status=%s\nmessage=%s\nbytes=%s\nfiles=%s\ntime=%s\n' "$1" "$2" "${3:-0}" "${4:-0}" "$(date +%s)" > "$STATUS.tmp" && mv "$STATUS.tmp" "$STATUS"
}

[ -f "$CONF" ] || { schrijf niet-ingesteld "NAS-koppeling niet ingesteld: ~/Tracks/_tools/opname-nas.conf ontbreekt"; exit 3; }
# shellcheck disable=SC1090
. "$CONF"       # NAS_HOST, NAS_USER, NAS_SHARE, optioneel NAS_SUBDIR (en DEST_DIR om te testen zonder NAS)
schrijf bezig "Kopiëren naar de NAS..."

MOUNTED_BY_US=0
MNT="$HOME/Tracks/_nas-opnames"
if [ -n "${DEST_DIR:-}" ]; then
  ROOT="$DEST_DIR"
else
  [ -n "${NAS_HOST:-}" ] && [ -n "${NAS_USER:-}" ] && [ -n "${NAS_SHARE:-}" ] || { schrijf niet-ingesteld "opname-nas.conf is onvolledig (NAS_HOST, NAS_USER, NAS_SHARE)"; exit 3; }
  mkdir -p "$MNT"
  if ! mount | grep -q " on $MNT "; then
    # Het wachtwoord staat in ~/.nsmbrc ([host:gebruiker] password=...). mount_smbfs leest dat bestand zelf niet goed als er
    # een @ of ander speciaal teken in het wachtwoord staat, dus lees het hier en geef het URL-gecodeerd mee.
    PW="$(awk -v sec="[${NAS_HOST}:${NAS_USER}]" '$0==sec{f=1;next} /^\[/{f=0} f&&/^password=/{sub(/^password=/,"");print;exit}' "$HOME/.nsmbrc" 2>/dev/null)"
    [ -n "$PW" ] || { schrijf niet-ingesteld "Wachtwoord ontbreekt in ~/.nsmbrc voor [${NAS_HOST}:${NAS_USER}]"; exit 3; }
    PWENC="$(python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1],safe=""))' "$PW")"
    if ! mount_smbfs "//${NAS_USER}:${PWENC}@${NAS_HOST}/${NAS_SHARE}" "$MNT" 2>"$STATUS.err"; then
      MELDING="$(tr '\n' ' ' < "$STATUS.err" | cut -c1-200)"
      schrijf fout "Koppelen aan de NAS mislukt: ${MELDING//$PWENC/***}"; rm -f "$STATUS.err"; exit 4
    fi
    MOUNTED_BY_US=1
  fi
  ROOT="$MNT"
fi

DEST="$ROOT/${NAS_SUBDIR:+$NAS_SUBDIR/}$(basename "$SRC")"
mkdir -p "$DEST" 2>"$STATUS.err" || { schrijf fout "Map op de NAS niet aan te maken: $(tr '\n' ' ' < "$STATUS.err" | cut -c1-160)"; rm -f "$STATUS.err"; exit 5; }

if ! rsync -rt --exclude '.DS_Store' --exclude '.naar-nas.*' "$SRC/" "$DEST/" 2>"$STATUS.err"; then
  schrijf fout "Kopiëren mislukt: $(tr '\n' ' ' < "$STATUS.err" | cut -c1-200)"; rm -f "$STATUS.err"
  [ "$MOUNTED_BY_US" = 1 ] && umount "$MNT" 2>/dev/null
  exit 6
fi
rm -f "$STATUS.err"

# Controle: dezelfde bestanden met dezelfde grootte aan beide kanten
lijst() { (cd "$1" && find . -type f ! -name '.DS_Store' ! -name '.naar-nas.*' -exec stat -f '%z %N' {} + | sort); }
A="$(lijst "$SRC")"; B="$(lijst "$DEST")"
if [ "$A" != "$B" ]; then
  schrijf fout "Controle mislukt: bestanden of groottes op de NAS wijken af van de opname"
  [ "$MOUNTED_BY_US" = 1 ] && umount "$MNT" 2>/dev/null
  exit 7
fi
BYTES=$(printf '%s\n' "$A" | awk '{s+=$1} END{print s+0}')
FILES=$(printf '%s\n' "$A" | grep -c .)
schrijf klaar "Gekopieerd en gecontroleerd" "$BYTES" "$FILES"
[ "$MOUNTED_BY_US" = 1 ] && umount "$MNT" 2>/dev/null
exit 0
