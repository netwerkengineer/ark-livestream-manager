import { NextRequest, NextResponse } from "next/server";
import { sendQlcScene, sendQlcOsc } from "@/lib/qlcControl";
import { isAuthorized } from "@/lib/authHelper";
import { getSettings } from "@/lib/settingsStore";
import WebSocket from "ws";

export async function POST(req: NextRequest) {
  const authSession = await isAuthorized(req, undefined, "lights");
  if (!authSession) {
    return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
  }

  try {
    const { sceneId, path, value, action } = await req.json();
    
    if (action === "resetAll") {
      const settings = getSettings();
      const host = settings.qlcHost || '127.0.0.1';
      const wsUrl = `ws://${host}:9999/qlcplusWS`;
      
      return new Promise<Response>((resolve) => {
        const ws = new WebSocket(wsUrl);
        
        ws.on('open', () => {
          const WIDGET_IDS = [
            1, 2, 3, 4, 20, 24, 81, 82, 83, 84, 85,
            ...[10, 30, 40, 50, 60, 100, 110, 120, 130].flatMap(startId => 
              Array.from({ length: 8 }, (_, i) => startId + 1 + i)
            ),
            201, 202, 203, 204, 205, 206, 207, 208
          ];
          
          // Send 0 to all widgets to turn off all Virtual Console buttons
          WIDGET_IDS.forEach((id, index) => {
            setTimeout(() => {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(`${id}|0`);
              }
            }, index * 2); // Small delay to avoid flooding QLC+ too fast
          });

          // Give it enough time to send all messages before closing
          setTimeout(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.close();
            }
            resolve(NextResponse.json({ success: true }));
          }, WIDGET_IDS.length * 2 + 100);
        });

        ws.on('error', (err) => {
          console.error("Failed to send resetAll:", err);
          resolve(NextResponse.json({ error: "Failed to connect to QLC+" }, { status: 500 }));
        });
      });
    }
    
    if (sceneId !== undefined) {
      sendQlcScene(sceneId);
      return NextResponse.json({ success: true });
    }

    if (path !== undefined && value !== undefined) {
      sendQlcOsc(path, value);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "No sceneId, path/value or action provided" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
