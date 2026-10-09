#!/bin/sh
# Bouwt ark-player (macOS, Swift). Resultaat: ./ark-player
cd "$(dirname "$0")" && swiftc -O -swift-version 5 ark-player.swift -o ark-player
