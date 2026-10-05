"use client";

import { useState, useEffect } from "react";
import type { ReaperState } from "@/lib/reaperControl";

// After a refused connection (e.g. logged out) EventSource gives up; try
// again this much later instead of hammering the server.
const RECONNECT_MS = 10_000;

// REAPER's state, pushed by /api/reaper/stream while the page is visible.
// One open connection instead of polling - the reverse proxy rate-limits
// per URL and bans clients that collect too many 429s.
export function useReaperState(enabled: boolean) {
  const [state, setState] = useState<ReaperState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const close = () => {
      clearTimeout(retry);
      es?.close();
      es = null;
    };
    const open = () => {
      close();
      if (document.hidden) return;
      es = new EventSource("/api/reaper/stream");
      es.onmessage = (e) => {
        setError(null);
        setState({ ...JSON.parse(e.data), receivedAt: Date.now() });
      };
      es.addEventListener("reaper-error", (e) => {
        setError(JSON.parse((e as MessageEvent).data).error);
      });
      es.onerror = () => {
        // CONNECTING: the browser retries itself (retry: 3000 from the server).
        // CLOSED: refused (401, server restart) - try again later ourselves.
        if (es?.readyState === EventSource.CLOSED) {
          setError("Verbinding met de server verbroken");
          retry = setTimeout(open, RECONNECT_MS);
        }
      };
    };
    const onVisibility = () => (document.hidden ? close() : open());

    open();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      close();
    };
  }, [enabled]);

  return { state, setState, error };
}

export async function reaperAction(body: object, endpoint = "/api/reaper"): Promise<void> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
}

export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
