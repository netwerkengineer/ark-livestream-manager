#!/bin/bash

echo "=== Mac Mini Startup Sequence ==="

# 1. Ensure the smart plug is ON
echo "Enabling smart plug power..."
python3 /app/control_plug.py on

# 2. Wait for Mac Mini to become reachable via SSH
mac_host="192.168.2.20"
mac_user="jeffreygo"

echo "Waiting for Mac Mini ($mac_host) to boot and become available on SSH..."
max_attempts=60
online=false

for ((i=1; i<=max_attempts; i++)); do
    if ssh -o ConnectTimeout=2 -o StrictHostKeyChecking=no -o PasswordAuthentication=no ${mac_user}@${mac_host} "echo 'online'" &>/dev/null; then
        echo "Mac Mini is online!"
        online=true
        break
    fi
    echo "Attempt $i/$max_attempts: Mac Mini is not reachable yet. Waiting 2s..."
    sleep 2
done

if [ "$online" = false ]; then
    echo "ERROR: Mac Mini did not become online within 2 minutes. Aborting."
    exit 1
fi

# 3. Wait an extra 5 seconds to ensure system GUI / login is fully initialized
echo "Waiting 5 seconds for system startup to stabilize..."
sleep 5

# 4. Import the Sunday project
echo "Running Sunday project import script..."
python3 /app/import_project.py

# 5. Launch OBS and FreeShow on the Mac Mini GUI session
echo "Launching OBS and FreeShow on Mac Mini..."
ssh -o StrictHostKeyChecking=no ${mac_user}@${mac_host} "open -a OBS && open -a FreeShow"

echo "=== Startup Sequence Completed ==="
