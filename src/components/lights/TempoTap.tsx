"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";

// Tap tempo: tap along with the music and the chases that follow the beat keep time. A step of such a chase lasts one beat; ½ and 2 make
// it twice as fast or twice as slow.

const MULTS = [{ v: 0.5, label: "2× sneller" }, { v: 1, label: "1 tel" }, { v: 2, label: "2× trager" }];
const MIN_BPM = 30, MAX_BPM = 240;

export default function TempoTap() {
  const [bpm, setBpm] = useState<number | null>(null);
  const [mult, setMult] = useState(1);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState(false);
  const taps = useRef<number[]>([]);

  const send = useCallback(async (b: number, m: number) => {
    try {
      const res = await fetch("/api/lights/tempo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bpm: b, mult: m }) });
      const j = await res.json();
      if (!res.ok || j.error) throw new Error(j.error || `HTTP ${res.status}`);
      setError("");
    } catch (err) { setError(err instanceof Error ? err.message : "Tempo doorgeven mislukt"); }
  }, []);

  useEffect(() => {
    fetch("/api/lights/tempo", { cache: "no-store" }).then(r => r.json()).then(j => { if (j.tempo) { setBpm(j.tempo.bpm); setMult(j.tempo.mult); } }).catch(() => { /* not known yet */ });
  }, []);

  const tap = useCallback(() => {
    const now = performance.now();
    const list = taps.current;
    if (list.length && now - list[list.length - 1] > 2500) list.length = 0;   // a pause starts a new count
    list.push(now);
    if (list.length > 6) list.shift();
    setFlash(true); setTimeout(() => setFlash(false), 90);
    if (list.length < 2) return;
    const avg = (list[list.length - 1] - list[0]) / (list.length - 1);
    const b = Math.round((60000 / avg) * 10) / 10;
    if (b < MIN_BPM || b > MAX_BPM) return;
    setBpm(b);
    send(b, mult);
  }, [mult, send]);

  // the B key taps too (not while typing in a field)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key.toLowerCase() !== "b" || e.metaKey || e.ctrlKey || e.altKey || t?.closest("input, textarea, select, [contenteditable]")) return;
      tap();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tap]);

  const change = (b: number) => { const v = Math.max(MIN_BPM, Math.min(MAX_BPM, Math.round(b * 10) / 10)); setBpm(v); send(v, mult); };

  return (
    <div className="tmp">
      <button className={`tmp-tap${flash ? " hit" : ""}`} onPointerDown={e => { e.preventDefault(); tap(); }} aria-label="Tik het tempo">Tik tempo <kbd>B</kbd></button>
      <label className="tmp-bpm">
        <input type="number" min={MIN_BPM} max={MAX_BPM} step={1} value={bpm ?? ""} placeholder="—" onChange={e => { const v = Number(e.target.value); if (v) change(v); }} aria-label="Slagen per minuut" />
        <span>BPM</span>
      </label>
      <span className="tmp-mult" role="group" aria-label="Verdeling">
        {MULTS.map(m => <button key={m.v} className={`stg-btn${mult === m.v ? " on" : ""}`} style={{ marginLeft: 0 }} onClick={() => { setMult(m.v); if (bpm) send(bpm, m.v); }}>{m.label}</button>)}
      </span>
      <span className="tmp-hint">Alleen chases met "Volgt het tempo" lopen mee.</span>
      {error && <span className="tmp-err">{error}</span>}
    </div>
  );
}
