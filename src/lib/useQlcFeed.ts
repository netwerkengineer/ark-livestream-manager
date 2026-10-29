"use client";

import { useEffect, useRef, useState } from "react";

// Live DMX values and channel types of QLC+ (server-sent events from /api/qlc/channels). The values are read through a ref
// (they change ten times a second); `tick` changes with them when a component wants to redraw. The channel types are also asked
// for once on their own (/api/lights/types), so they are known even when the live stream does not come through; `info` says why not.
export function useQlcFeed(onValues?: (values: number[], types: string[]) => void) {
  const values = useRef<number[]>([]);
  const types = useRef<string[]>([]);
  const [connected, setConnected] = useState(false);
  const [live, setLive] = useState(false);          // values really arrive
  const [info, setInfo] = useState("");
  const [tick, setTick] = useState(0);
  const callback = useRef(onValues);
  callback.current = onValues;

  useEffect(() => {
    let stop = false;
    fetch("/api/lights/types", { cache: "no-store" })
      .then(r => r.json())
      .then(j => {
        if (stop || j.error) { if (j.error) setInfo(j.error); return; }
        if (Array.isArray(j.types) && !types.current.some(Boolean)) { types.current = j.types; setTick(t => t + 1); callback.current?.(values.current, types.current); }
        if (j.message) setInfo(j.message);
      })
      .catch(() => { /* the stream below reports problems too */ });

    const es = new EventSource("/api/qlc/channels");
    es.onopen = () => setConnected(true);
    es.onerror = () => { setConnected(false); setLive(false); setInfo(i => i || "De live verbinding met de webapp is verbroken; er wordt opnieuw geprobeerd."); };
    es.onmessage = ev => {
      try {
        const d = JSON.parse(ev.data);
        if (d.error) { setInfo(d.error); return; }
        if (Array.isArray(d.v)) values.current = d.v;
        if (Array.isArray(d.t)) types.current = d.t;
        setLive(true); setInfo("");
        callback.current?.(values.current, types.current);
        setTick(t => t + 1);
      } catch { /* ignore a broken message */ }
    };
    return () => { stop = true; es.close(); };
  }, []);

  return { values, types, connected: connected && live, streamOpen: connected, info, tick };
}
