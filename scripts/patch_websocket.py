import re

with open('src/components/LightsControl.tsx', 'r') as f:
    content = f.read()

# Replace wsRef with eventSourceRef
content = content.replace(
    'const wsRef = useRef<WebSocket | null>(null);',
    'const eventSourceRef = useRef<EventSource | null>(null);'
)
content = content.replace(
    'const isWsConnected = useRef(false);',
    'const isWsConnected = useRef(false);'
)

# Remove ws.onopen, onmessage, onclose, onerror block and replace with EventSource
websocket_block_regex = r"let ws: WebSocket \| null = null;.*?if \(isMounted\) {\s*reconnectTimeout = setTimeout\(connect, 5000\);\s*}\s*}\s*};\s*connect\(\);"

event_source_block = """let es: EventSource | null = null;
    let reconnectTimeout: NodeJS.Timeout;
    let isMounted = true;

    const connect = () => {
      try {
        console.log("[QLC+ SSE] Connecting to /api/qlc/stream...");
        es = new EventSource('/api/qlc/stream');
        eventSourceRef.current = es;

        es.onopen = () => {
          console.log("[QLC+ SSE] Connected successfully!");
          isWsConnected.current = true;
        };

        es.onmessage = (event) => {
          if (!isMounted) return;
          const data = event.data;
          const parts = data.split('|');
          
          let widgetId: number | null = null;
          let value: number | null = null;

          if (parts[0] === 'QLC+API' && parts[1] === 'getWidgetStatus') {
            widgetId = parseInt(parts[2]);
            value = parseInt(parts[3]);
          } else if (parts.length >= 3 && !isNaN(parseInt(parts[0])) && (parts[1] === 'BUTTON' || parts[1] === 'SLIDER')) {
            widgetId = parseInt(parts[0]);
            value = parseInt(parts[2]);
          }

          if (widgetId !== null && value !== null && !isNaN(widgetId) && !isNaN(value)) {
            const isActive = value === 255;
            const now = Date.now();

            // 1. Fresnel Faders (81 - 85) with fighting prevention
            const lastChange = lastFaderChangeTime.current[widgetId] || 0;
            if (now - lastChange > 1200) { // 1.2s threshold
              if (widgetId === 81) setFresnel1(value);
              else if (widgetId === 82) setFresnel2(value);
              else if (widgetId === 83) setFresnel3(value);
              else if (widgetId === 84) setFresnel4(value);
              else if (widgetId === 85) setFresnelMaster(value);
            }
            
            // 2. Main Scenes (1 - 4)
            if ([1, 2, 3, 4].includes(widgetId)) {
              if (isActive) setActiveScene(widgetId);
              else setActiveScene(prev => prev === widgetId ? null : prev);
            }

            // 3. Chases (20, 24)
            else if ([20, 24].includes(widgetId)) {
              if (isActive) setActiveChase(widgetId);
              else setActiveChase(prev => prev === widgetId ? null : prev);
            }

            // 4. Color Pickers (11 - 138)
            else if (widgetId >= 11 && widgetId <= 138) {
              const lastDigit = widgetId % 10;
              if (lastDigit >= 1 && lastDigit <= 8) {
                const startId = widgetId - lastDigit;
                if ([10, 30, 40, 50, 60, 100, 110, 120, 130].includes(startId)) {
                  const sceneId = widgetId - 1;
                  setActiveColors(prev => ({ ...prev, [sceneId]: isActive }));
                }
              }
            }

            // 5. Strobe Buttons (201 - 208)
            else if (widgetId >= 201 && widgetId <= 208) {
              const sceneId = widgetId + 10; // button 201 -> chaser 211
              if (isActive) {
                setActiveStrobe(sceneId);
              } else {
                setActiveStrobe(prev => prev === sceneId ? null : prev);
              }
            }
          }
        };

        es.onerror = (err) => {
          isWsConnected.current = false;
          es?.close();
          eventSourceRef.current = null;
          console.error("[QLC+ SSE] Error occurred:", err);
          if (isMounted) {
            clearTimeout(reconnectTimeout);
            reconnectTimeout = setTimeout(connect, 5000);
          }
        };
      } catch (err) {
        console.error("[QLC+ SSE] Setup failed:", err);
        if (isMounted) {
          clearTimeout(reconnectTimeout);
          reconnectTimeout = setTimeout(connect, 5000);
        }
      }
    };

    connect();"""

content = re.sub(websocket_block_regex, event_source_block, content, flags=re.DOTALL)

# Cleanup the unmount handler
content = content.replace(
    'if (ws) ws.close();',
    'if (es) es.close();'
)

# Update handleResetAll
reset_block_old = """    // 1. WebSocket stopAllFunctions (if connected)
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.send("QLC+API|stopAllFunctions");
      } catch (err) {
        console.error("Failed to send stopAllFunctions over WS:", err);
      }
    }"""

reset_block_new = """    // 1. Send stopAllFunctions via API
    try {
      fetch("/api/qlc/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resetAll" }),
      });
    } catch (err) {
      console.error("Failed to send resetAll via API:", err);
    }"""

content = content.replace(reset_block_old, reset_block_new)

with open('src/components/LightsControl.tsx', 'w') as f:
    f.write(content)

