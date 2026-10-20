import { NextRequest } from "next/server";
import { getSettings } from "@/lib/settingsStore";
import { isAuthorized } from "@/lib/authHelper";
import WebSocket from "ws";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
    const authSession = await isAuthorized(req, undefined, "lights");
  if (!authSession) {
    return new Response("Unauthorized", { status: 401 });
  }

  const settings = getSettings();
  const host = settings.qlcHost || '127.0.0.1';
  
  // Create a transform stream for SSE
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();
  
  const encoder = new TextEncoder();
  const keepAliveInterval = setInterval(() => {
    writer.write(encoder.encode(": keepalive\n\n")).catch(() => {});
  }, 15000);

  // Connect to QLC+ WebSocket from the server
  const wsUrl = `ws://${host}:9999/qlcplusWS`;
  const ws = new WebSocket(wsUrl);

  ws.on('open', () => {
    console.log(`[QLC+ SSE] Connected to QLC+ WebSocket at ${wsUrl}`);
    // Request all widget statuses upon connection
    const WIDGET_IDS = [
      1, 2, 3, 4, 20, 24, 81, 82, 83, 84, 85,
      ...[10, 30, 40, 50, 60, 100, 110, 120, 130].flatMap(startId => 
        Array.from({ length: 8 }, (_, i) => startId + 1 + i)
      ),
      201, 202, 203, 204, 205, 206, 207, 208
    ];
    
    WIDGET_IDS.forEach((id, index) => {
      setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(`QLC+API|getWidgetStatus|${id}`);
        }
      }, index * 20);
    });
  });

  // QLC+ meldt kleuren die automatisch (als functie, zonder knop) zijn gestart niet uit zichzelf door: vraag ze regelmatig op
  const refreshInterval = setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) return;
    [10, 30, 40, 50, 60, 100, 110, 120, 130].forEach((startId, g) => {
      for (let i = 1; i <= 8; i++) {
        setTimeout(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send(`QLC+API|getWidgetStatus|${startId + i}`);
        }, (g * 8 + i) * 15);
      }
    });
  }, 6000);

  ws.on('message', (data) => {
    const message = data.toString();
    writer.write(encoder.encode(`data: ${message}\n\n`)).catch(() => {});
  });

  ws.on('close', () => {
    console.log(`[QLC+ SSE] WebSocket closed`);
    clearInterval(keepAliveInterval);
    clearInterval(refreshInterval);
    writer.close().catch(() => {});
  });

  ws.on('error', (err) => {
    console.error(`[QLC+ SSE] WebSocket error:`, err);
    clearInterval(keepAliveInterval);
    clearInterval(refreshInterval);
    writer.close().catch(() => {});
  });

  req.signal.addEventListener("abort", () => {
    console.log(`[QLC+ SSE] Client disconnected`);
    clearInterval(keepAliveInterval);
    clearInterval(refreshInterval);
    ws.close();
    writer.close().catch(() => {});
  });

  return new Response(stream.readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
