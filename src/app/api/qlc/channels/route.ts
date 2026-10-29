export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { isAuthorized } from "@/lib/authHelper";
import { feed, startFeed } from "@/lib/qlcFeed";

// Live DMX values of universe 1 as QLC+ has them (server-sent events). One connection to QLC+ for every viewer; the types of the
// channels (intensity with its colour, shutter, ...) come with the first message.
export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req, undefined, "lights"))) return new Response("Unauthorized", { status: 401 });
  const f = feed();
  const encoder = new TextEncoder();
  let send: (() => void) | null = null;
  let keepAlive: ReturnType<typeof setInterval> | null = null;
  const stream = new ReadableStream({
    start(controller) {
      let sentTypes = "";
      const write = (text: string) => { try { controller.enqueue(encoder.encode(text)); } catch { /* closed */ } };
      send = () => {
        const types = f.types.join(",");
        const body: Record<string, unknown> = { v: f.values };
        if (types !== sentTypes) { body.t = f.types; sentTypes = types; }
        write(`data: ${JSON.stringify(body)}\n\n`);
      };
      write(": open\n\n");   // flush the headers right away
      f.listeners.add(send);
      startFeed(f);
      if (f.values.length) send();
      // while QLC+ does not answer, say why (the viewer shows it)
      keepAlive = setInterval(() => write(f.error && !f.values.length ? `data: ${JSON.stringify({ error: f.error })}\n\n` : ": keepalive\n\n"), 5000);
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
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" } });
}
