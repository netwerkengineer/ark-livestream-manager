export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import WebSocket from "ws";
import { getSettings } from "@/lib/settingsStore";
import { isAuthorized } from "@/lib/authHelper";
import { readFixtures } from "@/lib/qlcWorkspace";

// Live DMX values of universe 1 as QLC+ has them (server-sent events). One connection to QLC+ for every viewer; the types of the
// channels (intensity with its colour, shutter, ...) come with the first message.
interface Feed { values: number[]; types: string[]; version: number; ws: WebSocket | null; timer: ReturnType<typeof setInterval> | null; listeners: Set<() => void>; host: string; count: number }
const g = globalThis as unknown as { __qlcFeed?: Feed };

function feed(): Feed {
  if (!g.__qlcFeed) g.__qlcFeed = { values: [], types: [], version: 0, ws: null, timer: null, listeners: new Set(), host: "", count: 0 };
  return g.__qlcFeed;
}

function channelCount(): number {
  try { return Math.min(512, Math.max(16, ...readFixtures().map(f => f.address + f.channels + 1))); } catch { return 128; }
}

function start(f: Feed) {
  const host = getSettings().qlcHost || "127.0.0.1";
  f.count = channelCount();
  if (f.ws && f.host === host) return;
  f.host = host;
  const ws = new WebSocket(`ws://${host}:9999/qlcplusWS`);
  f.ws = ws;
  ws.on("open", () => {
    f.timer = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send(`QLC+API|getChannelsValues|1|1|${f.count}`); }, 100);
  });
  ws.on("message", raw => {
    const parts = String(raw).split("|");
    if (parts[1] !== "getChannelsValues") return;
    // QLC+API|getChannelsValues|(<channel>|<value>|<type>|<flag>)*   (channels count from 1)
    const values: number[] = [], types: string[] = [];
    for (let i = 2; i + 3 < parts.length; i += 4) {
      const ch = Number(parts[i]);
      if (!Number.isFinite(ch)) break;
      values[ch - 1] = Number(parts[i + 1]) || 0;
      types[ch - 1] = parts[i + 2] || "";
    }
    const changed = values.length !== f.values.length || values.some((v, i) => v !== f.values[i]) || types.join("") !== f.types.join("");
    f.values = values; f.types = types;
    if (changed) { f.version++; f.listeners.forEach(l => l()); }
  });
  const reset = () => {
    if (f.timer) clearInterval(f.timer);
    f.timer = null; f.ws = null;
    setTimeout(() => { if (f.listeners.size) start(f); }, 2000);   // viewers still there: connect again
  };
  ws.on("close", reset);
  ws.on("error", () => { try { ws.close(); } catch { /* already closed */ } });
}

export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req, undefined, "lights"))) return new Response("Unauthorized", { status: 401 });
  const f = feed();
  const encoder = new TextEncoder();
  let send: (() => void) | null = null;
  let keepAlive: ReturnType<typeof setInterval> | null = null;
  const stream = new ReadableStream({
    start(controller) {
      let sentTypes = "";
      send = () => {
        const types = f.types.join(",");
        const body: Record<string, unknown> = { v: f.values };
        if (types !== sentTypes) { body.t = f.types; sentTypes = types; }
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(body)}\n\n`)); } catch { /* closed */ }
      };
      f.listeners.add(send);
      start(f);
      if (f.values.length) send();
      keepAlive = setInterval(() => { try { controller.enqueue(encoder.encode(": keepalive\n\n")); } catch { /* closed */ } }, 15000);
    },
    cancel() {
      if (send) f.listeners.delete(send);
      if (keepAlive) clearInterval(keepAlive);
      if (!f.listeners.size) { try { f.ws?.close(); } catch { /* ignore */ } }
    },
  });
  req.signal.addEventListener("abort", () => {
    if (send) f.listeners.delete(send);
    if (keepAlive) clearInterval(keepAlive);
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
}
