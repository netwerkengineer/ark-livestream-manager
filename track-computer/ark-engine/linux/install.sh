#!/bin/sh
# Zet Ark Tracks op deze computer: programma in ~/.local/bin, pictogram, startmenu-item en een snelkoppeling op het bureaublad.
# Gebruik: ./install.sh [pad/naar/ark-tracks]   (standaard: target/release/ark-tracks naast deze map)
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
BIN="${1:-$HERE/../target/release/ark-tracks}"
[ -x "$BIN" ] || { echo "Programma niet gevonden: $BIN (eerst bouwen: cargo build --release --features app)"; exit 1; }
mkdir -p "$HOME/.local/bin" "$HOME/.local/share/applications" "$HOME/.local/share/icons/hicolor/scalable/apps"
install -m 755 "$BIN" "$HOME/.local/bin/ark-tracks"
install -m 644 "$HERE/ark-tracks.svg" "$HOME/.local/share/icons/hicolor/scalable/apps/ark-tracks.svg"
cat > "$HOME/.local/share/applications/ark-tracks.desktop" <<DESK
[Desktop Entry]
Type=Application
Name=Ark Tracks
Comment=Tracks afspelen en bedienen
Exec=$HOME/.local/bin/ark-tracks
Icon=$HOME/.local/share/icons/hicolor/scalable/apps/ark-tracks.svg
Terminal=false
Categories=AudioVideo;Audio;
StartupWMClass=ark-tracks
DESK
chmod 644 "$HOME/.local/share/applications/ark-tracks.desktop"
DESKTOP="$(xdg-user-dir DESKTOP 2>/dev/null || echo "$HOME/Desktop")"
if [ -d "$DESKTOP" ]; then
  cp "$HOME/.local/share/applications/ark-tracks.desktop" "$DESKTOP/ark-tracks.desktop"
  chmod 755 "$DESKTOP/ark-tracks.desktop"
  # Cinnamon/GNOME willen een bureaubladstarter eerst "vertrouwen"
  gio set "$DESKTOP/ark-tracks.desktop" metadata::trusted true 2>/dev/null || true
  echo "Snelkoppeling: $DESKTOP/ark-tracks.desktop"
fi
update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true
echo "Klaar. Start Ark Tracks via het bureaublad of het startmenu."
