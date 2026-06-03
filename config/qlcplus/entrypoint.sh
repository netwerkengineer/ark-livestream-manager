#!/bin/bash
set -e

echo "=== Starting QLC+ (Headless, Operate Mode) ==="

# Prevent crash: remove any saved config from previous session
# QLC+ saves workspace paths that become invalid after restart,
# causing it to crash on boot. We clean this on every start.
rm -f "/root/.config/qlcplus/Q Light Controller Plus.conf"

# Start QLC+ without project in background
# -w: enable Web interface on port 9999
# -n: nogui - hide graphical interface
# -p: operate mode - load the virtual console in active state
# NOTE: We do NOT use -o (open workspace) because it silently fails
# on Synology NAS kernels. Instead, we load via the web API below.
qlcplus -w -n -p &
QLC_PID=$!

# Wait for web server to become available
echo "Waiting for QLC+ web server..."
for i in $(seq 1 30); do
    if curl -s -o /dev/null http://localhost:9999 2>/dev/null; then
        echo "Web server is ready!"
        break
    fi
    sleep 1
done
sleep 2

PROJECT="/QLC/ark_church_lighting.qxw"
if [ ! -f "$PROJECT" ]; then
    echo "No project file found at $PROJECT"
    echo "Load a project manually via the web interface at port 9999."
    wait $QLC_PID
    exit 0
fi

# Fetch the config page HTML to detect available network interfaces
CONFIG_HTML=$(curl -s http://localhost:9999/config)

# Auto-detect the LAN IP (192.168.x.x) from ArtNet plugin options
NAS_IP=$(echo "$CONFIG_HTML" | awk -F'"' '/\[ArtNet\] 192\.168\./ && /option value/ {match($0, /192\.168\.[0-9]+\.[0-9]+/); print substr($0, RSTART, RLENGTH); exit}')

if [ -z "$NAS_IP" ]; then
    echo "Warning: Could not detect LAN IP from ArtNet interfaces."
    echo "Loading project without universe configuration."
    curl -s -F "qlcFile=@$PROJECT" http://localhost:9999/loadProject > /dev/null
    echo "Please configure universes manually via http://<IP>:9999/config"
    wait $QLC_PID
    exit 0
fi

# Find the Line indexes for the detected IP address
ARTNET_LINE=$(echo "$CONFIG_HTML" | awk -v ip="$NAS_IP" -F'"' '$0 ~ "\\[ArtNet\\] "ip && /option value/ {split($2, a, "|"); print a[2]; exit}')
OSC_LINE=$(echo "$CONFIG_HTML" | awk -v ip="$NAS_IP" -F'"' '$0 ~ "\\[OSC\\] "ip && /option value/ {split($2, a, "|"); print a[2]; exit}')

echo "Auto-detected: IP=$NAS_IP, ArtNet Line=$ARTNET_LINE, OSC Line=$OSC_LINE"

# Create a modified copy of the project with correct universe mappings
# This injects the detected IP and Line indexes into the InputOutputMap XML
cp "$PROJECT" /tmp/project.qxw

sed -i '/<InputOutputMap>/,/<\/InputOutputMap>/c\
 <InputOutputMap>\
  <Universe Name="Universe 1" ID="0" Passthrough="True">\
   <Input Plugin="ArtNet" UID="'"$NAS_IP"'" Line="'"$ARTNET_LINE"'"><PluginParameters/></Input>\
   <Output Plugin="ArtNet" UID="'"$NAS_IP"'" Line="'"$ARTNET_LINE"'"><PluginParameters/></Output>\
  </Universe>\
  <Universe Name="Universe 2" ID="1">\
   <Input Plugin="OSC" UID="'"$NAS_IP"'" Line="'"$OSC_LINE"'"><PluginParameters/></Input>\
  </Universe>\
 </InputOutputMap>' /tmp/project.qxw

echo "Loading project with auto-configured universes..."
curl -s -F "qlcFile=@/tmp/project.qxw" http://localhost:9999/loadProject > /dev/null
echo "=== Project loaded successfully! ==="

wait $QLC_PID
