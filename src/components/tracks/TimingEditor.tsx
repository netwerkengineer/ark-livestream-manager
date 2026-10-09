"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { X, Timer, Save, RotateCcw, Play, Minus, Plus, AlertTriangle } from "lucide-react";
import type { ReaperState } from "@/lib/reaperControl";
import type { TimingSection } from "@/lib/trackTiming";
import { reaperAction } from "./useReaper";
import { sectionColor } from "./songName";

interface TimingData { sections: TimingSection[]; lead: number; showFile: string }

interface TimingEditorProps {
  song: { title: string; artist: string; path: string };
  state: ReaperState | null;
  onClose: () => void;
  onError: (message: string) => void;
  onStatus: (message: string) => void;
}

const STEP = 0.25;
const quarter = (x: number) => Math.round(x / STEP) * STEP;
const fmtBeat = (b: number) => (Number.isInteger(b) ? String(b) : b.toFixed(2).replace(/0$/, ""));
const fmtSec = (s: number) => `${s.toFixed(1).replace(".", ",")} s`;

// Place the FreeShow slides of each section by hand: drag the numbers on the line or type
// the beat (quarter notes from the section start). Slides you don't move keep their
// estimate (spread by text length). Saving rebuilds the cue table for this song.
export default function TimingEditor({ song, state, onClose, onError, onStatus }: TimingEditorProps) {
  const [data, setData] = useState<TimingData | null>(null);
  const [edits, setEdits] = useState<Record<string, Record<number, number>>>({});
  const [reset, setReset] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState<string | null>(null);
  const lineRefs = useRef<Record<string, HTMLDivElement | null>>({});
  // the drag handlers outlive a render: they read the latest edits through this ref
  const editsRef = useRef(edits);
  editsRef.current = edits;

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/reaper/arrangement/timing?path=${encodeURIComponent(song.path)}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error || `HTTP ${res.status}`);
      setData(json);
      setEdits({});
      setReset(new Set());
    } catch (err) {
      onError(err instanceof Error ? err.message : "Laden mislukt");
    }
  }, [song.path, onError]);

  useEffect(() => { load(); }, [load]);

  const lengthOf = (s: TimingSection) => (s.lengthQn !== null ? Math.floor(s.lengthQn / STEP) * STEP : 64);   // whole quarter beats
  const beatsOf = (s: TimingSection): Record<number, number> => {
    const own = editsRef.current[s.name];
    return Object.fromEntries(s.slides.filter(x => !x.fixed).map(x => [x.index, own?.[x.index] ?? x.beat]));
  };
  const isDirty = (s: TimingSection) => reset.has(s.name) || (!!edits[s.name] && s.slides.some(x => !x.fixed && edits[s.name][x.index] !== undefined && edits[s.name][x.index] !== x.beat));

  // Moving a slide: keep the order (at least a quarter beat from its neighbours) and stay inside the section
  const move = (s: TimingSection, index: number, target: number) => {
    const beats = beatsOf(s);
    const last = s.slides.length;
    const lo = (index === 2 ? 0 : beats[index - 1]) + STEP;
    const hi = index === last ? quarter(lengthOf(s) - 0.5) : beats[index + 1] - STEP;
    const next = Math.min(Math.max(quarter(target), lo), Math.max(lo, hi));
    setEdits(e => ({ ...e, [s.name]: { ...beatsOf(s), ...e[s.name], [index]: next } }));
    setReset(r => { if (!r.has(s.name)) return r; const n = new Set(r); n.delete(s.name); return n; });
  };

  const applyEstimate = (s: TimingSection) => {
    // order is kept even when two estimates fall close together
    const own: Record<number, number> = {};
    let prev = 0;
    for (const x of s.slides.filter(y => !y.fixed)) { prev = Math.max(x.estimate, prev + STEP); own[x.index] = prev; }
    setEdits(e => ({ ...e, [s.name]: own }));
    setReset(r => new Set(r).add(s.name));
  };

  const save = async (s: TimingSection) => {
    setSaving(s.name);
    try {
      const body: { path: string; name: string; at: Record<string, number> | null } = { path: song.path, name: s.name, at: null };
      if (!reset.has(s.name)) body.at = Object.fromEntries(Object.entries(beatsOf(s)).map(([k, v]) => [k, v]));
      const res = await fetch("/api/reaper/arrangement/timing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error || `HTTP ${res.status}`);
      onStatus(`Timing van "${s.name}" opgeslagen. Na een FreeShow-sync volgt FreeShow de nieuwe timing.`);
      await load();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Opslaan mislukt");
    } finally {
      setSaving(null);
    }
  };

  // Listen from a few beats before the slide (the saved timing is what FreeShow follows)
  const listen = async (s: TimingSection, beat: number) => {
    const active = state?.bridge?.tabs.find(t => t.active)?.path;
    if (active !== song.path) { onError("Maak dit nummer eerst actief in de setlist om te kunnen luisteren"); return; }
    if (!s.secPerQn) { onError("Van dit nummer is het tempo niet bekend"); return; }
    try {
      await reaperAction({ action: "seek", pos: Math.max(0, s.startSec + (beat - 4) * s.secPerQn) });
      if (state?.playState !== 1) await reaperAction({ action: "play" });
    } catch (err) {
      onError(err instanceof Error ? err.message : "Afspelen mislukt");
    }
  };

  // Drag a number on the line
  const drag = (s: TimingSection, index: number) => (e: React.PointerEvent<HTMLButtonElement>) => {
    const line = lineRefs.current[s.name];
    if (!line) return;
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const rect = line.getBoundingClientRect();
    const onMove = (ev: PointerEvent) => move(s, index, ((ev.clientX - rect.left) / rect.width) * lengthOf(s));
    const onUp = () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
  };

  const position = state?.position ?? 0;
  const active = state?.bridge?.tabs.find(t => t.active)?.path === song.path;

  return (
    <div className="trk-modal-backdrop" onClick={onClose}>
      <div className="glass-card trk-modal" onClick={e => e.stopPropagation()}>
        <div className="trk-setlist-head">
          <h3 className="trk-title"><Timer size={18} style={{ color: "#06b6d4" }} /> Timing van de dia&apos;s – {song.title}</h3>
          <button className="trk-icon-btn" onClick={onClose} aria-label="Sluiten"><X size={16} /></button>
        </div>

        {!data ? <p className="trk-empty">Laden…</p> : (
          <>
            <p className="trk-arr-hint">
              Sleep de nummers op de lijn of typ het moment in tellen vanaf het begin van de sectie (stappen van een kwart tel).
              De eerste dia van een sectie komt vanzelf {data.lead} tellen eerder. Dia&apos;s die je niet verplaatst, houden hun schatting.
              Opslaan zet de timing meteen in de cuetabel van dit nummer; luisteren (▶) volgt de <em>opgeslagen</em> timing.
              De timing geldt voor elke keer dat de sectie voorkomt.
            </p>
            <div className="trk-tim-list">
              {data.sections.filter(s => !s.instrumental && s.slides.length > 1).map(s => {
                const beats = beatsOf(s);
                const len = lengthOf(s);
                const dirty = isDirty(s);
                const here = active && s.secPerQn ? (position - s.startSec) / s.secPerQn : -1;
                return (
                  <div key={s.name} className="trk-tim-card" style={{ "--sec": sectionColor(s.name) } as React.CSSProperties}>
                    <div className="trk-tim-head">
                      <strong>{s.name}</strong>
                      <small>
                        {s.times}× · {s.lengthQn !== null ? `${fmtBeat(s.lengthQn)} tellen` : "lengte onbekend"}{s.secPerQn ? ` (${fmtSec(s.lengthSec)})` : ""}
                      </small>
                      <span className={`trk-badge${s.manual || dirty ? " on" : ""}`}>{dirty ? "niet opgeslagen" : s.manual ? "met de hand" : "geschat"}</span>
                    </div>
                    {s.mixedCounts && <p className="trk-warn"><AlertTriangle size={14} /> Niet elke keer heeft evenveel dia&apos;s; alleen de keren met evenveel dia&apos;s als de eerste gebruiken deze timing.</p>}

                    <div className="trk-tim-line" ref={el => { lineRefs.current[s.name] = el; }}>
                      {Array.from({ length: Math.floor(len) + 1 }, (_, b) => (
                        <i key={b} className={`trk-tim-tick${b % 4 === 0 ? " bar" : ""}`} style={{ left: `${(b / len) * 100}%` }} />
                      ))}
                      {here >= 0 && here <= len && <i className="trk-tim-now" style={{ left: `${(here / len) * 100}%` }} />}
                      {s.slides.map(x => (
                        <button
                          key={x.index}
                          className={`trk-tim-pin${x.fixed ? " fixed" : ""}${x.manual || edits[s.name]?.[x.index] !== undefined ? " set" : ""}`}
                          style={{ left: `${(Math.max(0, x.fixed ? 0 : beats[x.index]) / len) * 100}%` }}
                          onPointerDown={x.fixed ? undefined : drag(s, x.index)}
                          title={x.fixed ? "Eerste dia: komt vanzelf" : `${x.text || "(leeg)"} – ${fmtBeat(beats[x.index])} tellen`}
                          disabled={x.fixed}
                        >{x.index}</button>
                      ))}
                    </div>

                    <ol className="trk-tim-slides">
                      {s.slides.map(x => (
                        <li key={x.index} className={x.fixed ? "fixed" : ""}>
                          <span className="trk-tim-n">{x.index}</span>
                          <span className="trk-tim-text" title={x.text}>{x.text || "(leeg)"}</span>
                          {x.fixed ? (
                            <span className="trk-meta">{fmtBeat(data.lead)} tellen eerder</span>
                          ) : (
                            <span className="trk-tim-ctl">
                              <button className="trk-icon-btn" onClick={() => move(s, x.index, beats[x.index] - STEP)} aria-label="Kwart tel eerder"><Minus size={12} /></button>
                              <input
                                className="input-field trk-tim-input"
                                type="number"
                                step={STEP}
                                value={beats[x.index]}
                                onChange={e => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) move(s, x.index, v); }}
                              />
                              <button className="trk-icon-btn" onClick={() => move(s, x.index, beats[x.index] + STEP)} aria-label="Kwart tel later"><Plus size={12} /></button>
                              <span className="trk-meta trk-tim-sec">{s.secPerQn ? `≈ ${fmtSec(beats[x.index] * s.secPerQn)}` : ""}</span>
                              <button className="trk-icon-btn" onClick={() => listen(s, beats[x.index])} title="Luister vanaf een paar tellen ervoor"><Play size={12} /></button>
                            </span>
                          )}
                        </li>
                      ))}
                    </ol>

                    <div className="trk-arr-actions">
                      <button className="trk-save" onClick={() => applyEstimate(s)} title="Terug naar de schatting op basis van de tekstlengte"><RotateCcw size={14} /> Schatting</button>
                      <button className="trk-load" onClick={() => save(s)} disabled={!dirty || saving !== null}>
                        <Save size={14} /> {saving === s.name ? "Bezig…" : "Opslaan"}
                      </button>
                    </div>
                  </div>
                );
              })}
              {data.sections.every(s => s.instrumental || s.slides.length < 2) && (
                <p className="trk-empty">Er zijn geen secties met meer dan één dia om te timen.</p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
