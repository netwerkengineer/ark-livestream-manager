#!/bin/zsh
# Zet alle MultiTracks-downloads (zips/mappen) in ~/Tracks/Songs om naar REAPER-projecten.
python3 ~/Tracks/_tools/mt2reaper.py ~/Tracks/Songs --all --config ~/Tracks/_tools/busses.json
echo
read -k 1 "?Druk op een toets om te sluiten..."
echo
