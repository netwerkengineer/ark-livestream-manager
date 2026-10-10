export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { isAuthorized } from "@/lib/authHelper";
import { getSettings } from "@/lib/settingsStore";
import { reaperRequest, parseReaperState, sendBridgeCommand, STATE_COMMANDS } from "@/lib/reaperControl";
import { rebuildIfShowChanged } from "@/lib/trackArrangement";
import { isDesktopBackend, playerState, watch, deviceLabel } from "@/lib/desktopLink";

const INTERVAL_MS = 300;

// Keeps the bridge's output mode and slide lead time equal to the settings
// (the bridge remembers them itself, this covers changing a setting and a
// fresh install).
let lastSync = 0;
function syncBridgeSettings(bridge: { outputMode?: string; leadBeats?: number; freeshow?: string }) {
  if (Date.now() - lastSync < 5000) return;
  const settings = getSettings();
  const mode = settings.reaperOutputMode || "auto";
  const lead = settings.reaperCueLeadBeats ?? 2;
  // FreeShow's REST API listens one port above its WebSocket API (5505 -> 5506)
  const fsHost = settings.freeShowHost || "";
  const fsPort = (settings.freeShowPort || 5505) + 1;
  const freeshow = fsHost ? `${fsHost}:${fsPort}` : undefined;
  if (bridge.freeshow !== freeshow) {
    lastSync = Date.now();
    sendBridgeCommand("freeshow", fsHost ? [fsHost, String(fsPort)] : ["", ""]).catch(() => undefined);
  } else if (bridge.outputMode !== mode) {
    lastSync = Date.now();
    sendBridgeCommand("output", [mode]).catch(() => undefined);
  } else if (bridge.leadBeats !== lead) {
    lastSync = Date.now();
    sendBridgeCommand("lead", [String(lead)]).catch(() => undefined);
  }
}

// A show edited in FreeShow (and synced back) gets its Tracks layout and cues
// rebuilt; checked for the active song now and then.
let lastShowCheck = 0;
function checkActiveShow(activePath: string | undefined) {
  if (!activePath || Date.now() - lastShowCheck < 20000) return;
  lastShowCheck = Date.now();
  rebuildIfShowChanged(activePath).catch(err => console.warn("[Tracks] Show-controle mislukt:", err));
}

// REAPER's state as a Server-Sent Events stream: one long-lived request per
// open Tracks screen instead of a poll every 300 ms. The reverse proxy in
// front of the test environment rate-limits per URL and bans clients that
// collect too many 429s, so polling from phones/tablets got them banned.
export async function GET(req: NextRequest) {
  const authSession = await isAuthorized(req, undefined, "tracks");
  if (!authSession) {
    return new Response("Niet geautoriseerd", { status: 401 });
  }

  const encoder = new TextEncoder();
  let closed = false;
  const unwatch = watch(authSession.username, deviceLabel(req.headers.get("user-agent")));
  req.signal.addEventListener("abort", () => { closed = true; unwatch(); });

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string | null, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`${event ? `event: ${event}\n` : ""}data: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };
      // Reconnect after 3 s if the connection drops
      controller.enqueue(encoder.encode("retry: 3000\n\n"));

      while (!closed) {
        if (isDesktopBackend()) {
          // the desktop app is the player: its state comes from the app (it reports in a few times a second)
          const p = playerState();
          if (p.online && p.state) send(null, p.state);
          else send("reaper-error", { error: p.name ? `Desktop-app (${p.name}) is niet verbonden` : "Geen desktop-app verbonden" });
        } else if (!getSettings().reaperEnabled) {
          send("reaper-error", { error: "Tracks (REAPER) is uitgeschakeld" });
        } else {
          try {
            const state = parseReaperState(await reaperRequest(STATE_COMMANDS));
            if (state.bridge) {
              state.bridge.songs = [];
              syncBridgeSettings(state.bridge);
              checkActiveShow(state.bridge.tabs.find(t => t.active)?.path);
            }
            send(null, state);
          } catch (err) {
            send("reaper-error", { error: `REAPER niet bereikbaar: ${err instanceof Error ? err.message : String(err)}` });
          }
        }
        await new Promise(r => setTimeout(r, INTERVAL_MS));
      }
      try { controller.close(); } catch { /* already closed */ }
    },
    cancel() {
      closed = true;
      unwatch();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
