#!/bin/bash
# Verwijdert een opname-map van de NAS (SMB-share), op verzoek van de knop "Verwijderen" in de Tracks-tab.
# Raakt alleen <share>/<NAS_SUBDIR>/<naam> aan, nooit iets op de track-computer (behalve de markering .naar-nas.status van die opname).
# De voortgang staat in ~/Tracks/_tools/.nas-wissen.status.
#
# Gebruik: opname-van-nas-wissen.sh <naam van de opnamemap>
# Instellingen: ~/Tracks/_tools/opname-nas.conf (dezelfde als voor opname-naar-nas.sh)
set -u
NAAM="${1:-}"
CONF="${ARK_OPNAME_CONF:-$HOME/Tracks/_tools/opname-nas.conf}"
STATUS="${ARK_WISSEN_STATUS:-$HOME/Tracks/_tools/.nas-wissen.status}"
LOKAAL="${ARK_OPNAMEMAP:-$HOME/Tracks/Opnames}"

schrijf() {   # status, melding
  printf 'status=%s\nmessage=%s\nname=%s\ntime=%s\n' "$1" "$2" "$NAAM" "$(date +%s)" > "$STATUS.tmp" && mv "$STATUS.tmp" "$STATUS"
}

case "$NAAM" in ""|.*|*/*) schrijf fout "Ongeldige opnaam"; exit 2;; esac
[ -f "$CONF" ] || { schrijf niet-ingesteld "NAS-koppeling niet ingesteld: ~/Tracks/_tools/opname-nas.conf ontbreekt"; exit 3; }
# shellcheck disable=SC1090
. "$CONF"
schrijf bezig "Verwijderen van de NAS..."

MOUNTED_BY_US=0
MNT="$HOME/Tracks/_nas-opnames"
if [ -n "${DEST_DIR:-}" ]; then
  ROOT="$DEST_DIR"
else
  [ -n "${NAS_HOST:-}" ] && [ -n "${NAS_USER:-}" ] && [ -n "${NAS_SHARE:-}" ] || { schrijf niet-ingesteld "opname-nas.conf is onvolledig (NAS_HOST, NAS_USER, NAS_SHARE)"; exit 3; }
  mkdir -p "$MNT"
  if ! mount | grep -q " on $MNT "; then
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
ontkoppel() { [ "$MOUNTED_BY_US" = 1 ] && umount "$MNT" 2>/dev/null; return 0; }

BASIS="$ROOT/${NAS_SUBDIR:+$NAS_SUBDIR/}"
DOEL="${BASIS}${NAAM}"
if [ ! -d "$DOEL" ]; then
  schrijf klaar "Stond niet (meer) op de NAS"
  rm -f "$LOKAAL/$NAAM/.naar-nas.status"; ontkoppel; exit 0
fi
if ! rm -rf -- "$DOEL" 2>"$STATUS.err" || [ -e "$DOEL" ]; then
  schrijf fout "Verwijderen van de NAS mislukt: $(tr '\n' ' ' < "$STATUS.err" 2>/dev/null | cut -c1-160)"; rm -f "$STATUS.err"; ontkoppel; exit 6
fi
rm -f "$STATUS.err"
# de opname staat niet meer op de NAS: de markering "gekopieerd" bij de lokale opname (als die er nog is) weghalen
rm -f "$LOKAAL/$NAAM/.naar-nas.status"
schrijf klaar "Verwijderd van de NAS"
ontkoppel
exit 0
