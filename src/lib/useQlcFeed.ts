"use client";

import { useEffect, useRef, useState } from "react";

// Live DMX values and channel types of QLC+ (server-sent events from /api/qlc/channels). The values are read through a ref
// (they change ten times a second); `tick` changes with them when a component wants to redraw.
export function useQlcFeed(onValues?: (values: number[], types: string[]) => void) {
  const values = useRef<number[]>([]);
  const types = useRef<string[]>([]);
  const [connected, setConnected] = useState(false);
  const [tick, setTick] = useState(0);
  const callback = useRef(onValues);
  callback.current = onValues;

  useEffect(() => {
    const es = new EventSource("/api/qlc/channels");
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = ev => {
      try {
        const d = JSON.parse(ev.data);
        if (Array.isArray(d.v)) values.current = d.v;
        if (Array.isArray(d.t)) types.current = d.t;
        callback.current?.(values.current, types.current);
        setTick(t => t + 1);
      } catch { /* ignore a broken message */ }
    };
    return () => es.close();
  }, []);

  return { values, types, connected, tick };
}
