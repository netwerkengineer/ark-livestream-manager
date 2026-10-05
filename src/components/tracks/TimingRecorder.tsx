"use client";

import React, { useEffect, useRef, useState } from "react";
import { Timer, Hand, Save, X } from "lucide-react";
import type { ReaperState } from "@/lib/reaperControl";
import { reaperAction } from "./useReaper";
import { sectionColor } from "./songName";

interface TimingRecorderProps {
  state: ReaperState | null;
  onError: (message: string) => void;
  onStatus: (message: string) => void;
}

// "Timing opnemen": while the song plays, tap at the moment the next FreeShow
// slide should appear. The first slide of a section comes by itself; the taps
// set slide 2, 3, ... and replace the estimate (by text length) for that
// section from then on.
export default function TimingRecorder({ state, onError, onStatus }: TimingRecorderProps) {
  const [busy, setBusy] = useState(false);
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; });

  const bridge = state?.bridge;
  const recording = !!bridge?.recording;
  const playing = state?.playState === 1;
  const position = state?.position || 0;
  const section = state?.regions.find(r => position >= r.start && position < r.end);

  const run = async (body: object) => {
    try {
      await reaperAction(body);
      return true;
    } catch (err) {
      onError(err instanceof Error ? err.message : "Actie mislukt");
      return false;
    }
  };

  // REAPER's position right now: the last streamed position plus the time
  // since it arrived (the tap is recorded where it was tapped, not where
  // REAPER is when the request gets there)
  const tap = () => {
    const s = stateRef.current;
    if (!s?.bridge?.recording) return;
    const pos = s.playState === 1 && s.receivedAt ? s.position + (Date.now() - s.receivedAt) / 1000 : s.position;
    run({ action: "tap", pos });
  };

  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat) return;
      const el = e.target as HTMLElement | null;
      if (el && ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return;
      e.preventDefault();
      tap();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [recording]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/reaper", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "recordSave" }),
      });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error || `HTTP ${res.status}`);
      onStatus(json.sections.length
        ? `Timing opgeslagen voor: ${json.sections.join(", ")}.`
        : "Niets getikt, er is niets veranderd.");
    } catch (err) {
      onError(err instanceof Error ? err.message : "Opslaan mislukt");
    } finally {
      setBusy(false);
    }
  };

  if (!bridge) return null;

  if (!recording) {
    return (
      <section className="glass-card trk-timing">
        <div className="trk-setlist-head" style={{ marginBottom: 0 }}>
          <h3 className="trk-title"><Timer size={18} style={{ color: "#eab308" }} /> Timing FreeShow</h3>
          <button className="trk-save" onClick={() => run({ action: "recordStart" })} disabled={!bridge.hasCues}
            title={bridge.hasCues ? "Tik tijdens het afspelen wanneer de volgende dia moet komen" : "Koppel eerst de tekst aan de secties (knop Tekst in de setlist)"}>
            <Timer size={14} /> Timing opnemen
          </button>
        </div>
        {!bridge.hasCues && <p className="trk-empty" style={{ marginTop: 8 }}>Voor dit nummer is nog geen tekst gekoppeld (knop &quot;Tekst&quot; in de setlist).</p>}
      </section>
    );
  }

  return (
    <section className="glass-card trk-timing recording">
      <div className="trk-setlist-head">
        <h3 className="trk-title"><span className="trk-rec-dot" /> Timing opnemen</h3>
        <button className="trk-load" onClick={save} disabled={busy}><Save size={14} /> Opslaan</button>
        <button className="trk-icon-btn" onClick={() => run({ action: "recordCancel" })} title="Stoppen zonder opslaan"><X size={14} /> Annuleren</button>
      </div>
      <p className="trk-arr-hint">
        Speel het nummer af en tik op het moment dat de <b>volgende dia</b> moet komen (of druk op de spatiebalk).
        De eerste dia van elke sectie komt vanzelf. Wat je tikt, vervangt de schatting voor die sectie.
      </p>
      <div className="trk-tap-row">
        <div className="trk-tap-info" style={{ "--sec": sectionColor(section?.name || "") } as React.CSSProperties}>
          <span className="trk-label">Sectie</span>
          <strong>{section?.name || "—"}</strong>
          <small>dia {bridge.recSlide || 1}{bridge.recSlides ? ` van ${bridge.recSlides}` : ""}</small>
        </div>
        <button className="trk-tap" onClick={tap} disabled={!playing}>
          <Hand size={28} /> Volgende dia
        </button>
      </div>
      {!playing && <p className="trk-empty">Start het afspelen om te tikken.</p>}
    </section>
  );
}
