#!/bin/bash
echo "=== Starting Graceful Mac Mini Shutdown Sequence ==="

# 1. Send SSH sleep command to the Mac Mini
echo "1. Sending remote sleep command to Mac Mini..."
ssh -o StrictHostKeyChecking=no -i /root/.ssh/id_ed25519 jeffreygo@192.168.2.20 "pmset sleepnow"
SSH_STATUS=$?

if [ $SSH_STATUS -ne 0 ]; then
    echo "⚠️ Warning: Failed to send SSH sleep command. Mac Mini might be offline already."
fi

# 2. Wait 5 seconds for Mac Mini to enter sleep mode...
echo "2. Waiting 5 seconds for Mac Mini to enter sleep state..."
sleep 5

# 3. Turn off the smart plug power
echo "3. Turning off the smart plug power..."
python3 /app/control_plug.py off
PLUG_STATUS=$?

if [ $PLUG_STATUS -eq 0 ]; then
    echo "✅ Success: Power cut successfully. System is safe and offline."
else
    echo "❌ Error: Failed to cut power. Check plug connection."
    exit 1
fi
