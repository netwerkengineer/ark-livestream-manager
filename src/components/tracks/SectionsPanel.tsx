"use client";

import React, { useState } from "react";
import { Repeat, ListMusic, AlertTriangle } from "lucide-react";
import type { ReaperState, JumpMode } from "@/lib/reaperControl";
import { reaperAction, formatTime } from "./useReaper";
import { sectionColor } from "./songName";

interface SectionsPanelProps {
  state: ReaperState | null;
  onError: (message: string) => void;
  stage?: boolean;
}

const MODES: { id: JumpMode; label: string; hint: string }[] = [
  { id: "end", label: "Einde sectie", hint: "Huidige sectie afmaken, dan naadloos door" },
  { id: "bar", label: "Volgende maat", hint: "Springt op de eerstvolgende maatstreep" },
  { id: "now", label: "Direct", hint: "Springt meteen" },
];

export default function SectionsPanel({ state, onError, stage }: SectionsPanelProps) {
  // Shown until the next poll confirms (or clears) it
  const [requested, setRequested] = useState<number | null>(null);

  const bridge = state?.bridge;
  const regions = state?.regions || [];
  const playing = state?.playState === 1;
  const current = bridge?.region ?? regions.find(r => state && state.position >= r.start && state.position < r.end)?.id;
  const pending = bridge?.pending ?? (playing ? requested : null);
  const looping = bridge?.loop;
  const mode = bridge?.mode || "end";

  const run = async (body: object) => {
    try {
      await reaperAction(body);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Actie mislukt");
    }
  };

  const jump = (id: number) => {
    setRequested(id);
    setTimeout(() => setRequested(null), 1500);
    run({ action: "jump", region: id, mode });
  };

  return (
    <section className={`glass-card trk-sections${stage ? " stage" : ""}`}>
      <div className="trk-sections-head">
        <h3 className="trk-title"><ListMusic size={18} style={{ color: "#06b6d4" }} /> Arrangement</h3>
        <div className="trk-modes" role="radiogroup" aria-label="Sprongmoment">
          {MODES.map(m => (
            <button
              key={m.id}
              role="radio"
              aria-checked={mode === m.id}
              className={`trk-mode${mode === m.id ? " on" : ""}`}
              title={m.hint}
              onClick={() => run({ action: "mode", mode: m.id })}
              disabled={!bridge}
            >
              {m.label}
            </button>
          ))}
        </div>
        <button
          className={`trk-loop${looping ? " on" : ""}`}
          onClick={() => run({ action: "loop", value: !looping })}
          disabled={!bridge || !regions.length}
          title="Huidige sectie herhalen tot je hem weer uitzet"
        >
          <Repeat size={16} /> {looping ? "Loop aan" : "Loop sectie"}
        </button>
      </div>

      {!bridge && (
        <p className="trk-warn"><AlertTriangle size={14} /> De REAPER-bridge draait niet; secties springen kan nu niet.</p>
      )}
      {state && regions.length === 0 && (
        <p className="trk-warn"><AlertTriangle size={14} /> Dit project heeft geen secties (regions). Maak het opnieuw met mt2reaper.</p>
      )}

      <div className="trk-section-grid">
        {regions.map(r => {
          const isCurrent = r.id === current;
          const isPending = r.id === pending;
          const isLoop = r.id === looping;
          return (
            <button
              key={r.id}
              className={`trk-section${isCurrent ? " current" : ""}${isPending ? " pending" : ""}${isLoop ? " loop" : ""}`}
              style={{ "--sec": sectionColor(r.name) } as React.CSSProperties}
              onClick={() => jump(r.id)}
              disabled={!bridge}
            >
              <span className="trk-section-name">{r.name}</span>
              <small>{isPending ? "volgt…" : isLoop ? "loop" : formatTime(r.start)}</small>
              {isCurrent && playing && state && (
                <span className="trk-section-progress" style={{ width: `${Math.min(100, ((state.position - r.start) / (r.end - r.start)) * 100)}%` }} />
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}
