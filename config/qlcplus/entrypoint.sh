#!/bin/bash
set -e

echo "=== Starting QLC+ v5 (Headless, Netwerk-first Mode) ==="

# Clean any configuration file that might cause boot issues or contain stale workspace paths
rm -f "/root/.config/qlcplus/Q Light Controller Plus.conf"
rm -f "/root/.qlcplus/Q Light Controller Plus.conf"

# Start QLC+ v5 in headless web-modus op poort 9999
qlcplus-qml --web --web-port 9999 &
QLC_PID=$!

echo "Waiting for QLC+ v5 web server..."
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
    wait $QLC_PID
    exit 0
fi

# Interface auto-detectie
CONFIG_HTML=$(curl -s http://localhost:9999/config)
NAS_IP=$(echo "$CONFIG_HTML" | awk -F'"' '/\[ArtNet\] 192\.168\./ && /option value/ {match($0, /192\.168\.[0-9]+\.[0-9]+/); print substr($0, RSTART, RLENGTH); exit}')

if [ -z "$NAS_IP" ]; then
    NAS_IP=$(echo "$CONFIG_HTML" | awk -F'"' '/\[ArtNet\] (192\.|172\.|10\.)[0-9]+\.[0-9]+\.[0-9]+/ && /option value/ {match($0, /[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+/); print substr($0, RSTART, RLENGTH); exit}')
fi
if [ -z "$NAS_IP" ]; then NAS_IP="127.0.0.1"; fi

ARTNET_LINE=$(echo "$CONFIG_HTML" | awk -v ip="$NAS_IP" -F'"' '$0 ~ "\\[ArtNet\\] "ip && /option value/ {split($2, a, "|"); print a[2]; exit}')
OSC_LINE=$(echo "$CONFIG_HTML" | awk -v ip="$NAS_IP" -F'"' '$0 ~ "\\[OSC\\] "ip && /option value/ {split($2, a, "|"); print a[2]; exit}')

if [ -z "$ARTNET_LINE" ]; then ARTNET_LINE="0"; fi
if [ -z "$OSC_LINE" ]; then OSC_LINE="0"; fi

echo "Auto-detected: IP=$NAS_IP, ArtNet Line=$ARTNET_LINE, OSC Line=$OSC_LINE"

cp "$PROJECT" /tmp/project.qxw

if [ "$QLC_OUTPUT_IP" != "broadcast" ] && [ -n "$QLC_OUTPUT_IP" ]; then
    OUTPUT_PARAMS="<PluginParameters outputIP=\"$QLC_OUTPUT_IP\"/>"
else
    OUTPUT_PARAMS="<PluginParameters/>"
fi

# Injecteer de gedetecteerde poorten in het XML-bestand
sed -i '/<InputOutputMap>/,/<\/InputOutputMap>/c\
 <InputOutputMap>\
  <Universe Name="Universe 1" ID="0" Passthrough="True">\
   <Input Plugin="ArtNet" UID="'"$NAS_IP"'" Line="'"$ARTNET_LINE"'"><PluginParameters/></Input>\
   <Output Plugin="ArtNet" UID="'"$NAS_IP"'" Line="'"$ARTNET_LINE"'">'"$OUTPUT_PARAMS"'</Output>\
  </Universe>\
  <Universe Name="Universe 2" ID="1">\
   <Input Plugin="OSC" UID="'"$NAS_IP"'" Line="'"$OSC_LINE"'"><PluginParameters/></Input>\
  </Universe>\
 </InputOutputMap>' /tmp/project.qxw

echo "Loading project into QLC+ v5 via API..."
# V5 API-call om de workspace direct te laden
curl -s -X POST -F "file=@/tmp/project.qxw" http://localhost:9999/api/v1/project > /dev/null
echo "=== QLC+ v5 Project succesvol geladen! ==="

wait $QLC_PID
