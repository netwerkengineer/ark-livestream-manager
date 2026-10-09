#!/bin/sh
# Bouwt build/ArkTracks.app (macOS). Start met: open build/ArkTracks.app
set -e
cd "$(dirname "$0")"
rm -rf build/ArkTracks.app 2>/dev/null || true
mkdir -p build/ArkTracks.app/Contents/MacOS build/ArkTracks.app/Contents/Resources
swiftc -O -swift-version 5 main.swift ../ark-player/core.swift ../ark-player/cues.swift ../ark-player/player.swift ../ark-player/server.swift -o build/ArkTracks.app/Contents/MacOS/ArkTracks
cat > build/ArkTracks.app/Contents/Info.plist <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Ark Tracks</string>
  <key>CFBundleDisplayName</key><string>Ark Tracks</string>
  <key>CFBundleIdentifier</key><string>nl.arkchurch.tracks-desktop</string>
  <key>CFBundleExecutable</key><string>ArkTracks</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSLocalNetworkUsageDescription</key><string>Ark Tracks maakt verbinding met de server en met FreeShow.</string>
  <key>NSAppTransportSecurity</key><dict><key>NSAllowsArbitraryLoadsInWebContent</key><true/><key>NSAllowsLocalNetworking</key><true/></dict>
</dict></plist>
PLIST
codesign -s - --force build/ArkTracks.app >/dev/null 2>&1 || true
echo "klaar: $(pwd)/build/ArkTracks.app"
