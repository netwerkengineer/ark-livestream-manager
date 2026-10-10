export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { desktopGuard } from "@/lib/trackDesktop";
import { subscribe } from "@/lib/desktopLink";

// The commands for one desktop app, as a Server-Sent Events stream (the app listens, the server pushes)
export async function GET(req: NextRequest) {
  const guard = await desktopGuard(req);
  if (!guard.ok) return new Response(guard.error, { status: guard.status });
  const id = req.nextUrl.searchParams.get("player") || "";
  const kinds = (req.nextUrl.searchParams.get("kinds") || "reaper,setlist").split(",").filter(k => k === "reaper" || k === "setlist");

  const encoder = new TextEncoder();
  let closed = false;
  let unsubscribe: (() => void) | null = null;
  let beat: ReturnType<typeof setInterval> | undefined;
  const stop = () => { closed = true; clearInterval(beat); unsubscribe?.(); };
  req.signal.addEventListener("abort", stop);

  const stream = new ReadableStream({
    start(controller) {
      const send = (text: string) => { if (closed) return; try { controller.enqueue(encoder.encode(text)); } catch { stop(); } };
      unsubscribe = subscribe(id, kinds, cmd => send(`event: cmd\ndata: ${JSON.stringify(cmd)}\n\n`));
      if (!unsubscribe) { send("event: unknown\ndata: {}\n\n"); stop(); try { controller.close(); } catch { /* closed */ } return; }
      send("retry: 2000\n\n");
      beat = setInterval(() => send(": hartslag\n\n"), 15000);
    },
    cancel() { stop(); },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", "Connection": "keep-alive", "X-Accel-Buffering": "no" },
  });
}
