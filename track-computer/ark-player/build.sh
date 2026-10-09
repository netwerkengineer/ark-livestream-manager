#!/bin/sh
# Bouwt ark-player (macOS, Swift). Resultaat: ./ark-player
cd "$(dirname "$0")" && swiftc -O -swift-version 5 *.swift -o ark-player
