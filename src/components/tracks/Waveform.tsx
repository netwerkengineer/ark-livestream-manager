"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import type { ReaperState } from "@/lib/reaperControl";
import { engineCall, hasDesktopEngine } from "@/lib/desktopEngine";
import { reaperAction, formatTime } from "./useReaper";
import { sectionColor } from "./songName";
import type { TimingSection } from "@/lib/trackTiming";
import { buildMarkers, placeSlide, qnOfSec, type CueMarker } from "./cueMarks";

// Waveform of the whole song with the sections on it, the playhead, and a click to jump to a section (with the jump mode that is set).
// The peaks come from the app's own player (/peaks): with REAPER as the player there is no waveform and nothing is shown here.

interface Peaks { rate: number; total: number; path: string; peaks: number[]; rms: number[]; bars?: number[]; beats?: number[] }

interface WaveformProps {
  state: ReaperState | null;
  onError: (message: string) => void;
  stage?: boolean;
}

const HEIGHT = 120;
const LABEL_H = 22;
const GAP = 2;   // space between two sections
const LANE = 40;  // the lane with the FreeShow slides under the waveform (only while placing slides)

// A section that is too narrow for its name gets a short form (Refrain 4 -> R4) and, if that does not fit either, no label
const SHORT: Record<string, string> = { verse: "V", chorus: "C", bridge: "B", refrain: "R", intro: "I", outro: "O", turnaround: "T", ending: "E", "count off": "CO", pre: "P", "pre-chorus": "PC", interlude: "IL", instrumental: "IN", tag: "TG" };
function shortName(name: string): string {
  const m = name.trim().match(/^(.*?)\s*(\d+)?$/);
  const base = (m?.[1] || name).trim().toLowerCase();
  return (SHORT[base] || base.slice(0, 2).toUpperCase()) + (m?.[2] || "");
}

export default function Waveform({ state, onError, stage }: WaveformProps) {
  const [data, setData] = useState<Peaks | null>(null);
  const [width, setWidth] = useState(0);
  const [tip, setTip] = useState<{ x: number; text: string } | null>(null);
  // Placing the FreeShow slides: markers on the waveform, drag them or put the selected slide at the playhead
  const [cueMode, setCueMode] = useState(false);
  const [timing, setTiming] = useState<{ sections: TimingSection[]; lead: number } | null>(null);
  const [timingError, setTimingError] = useState("");
  const [edits, setEdits] = useState<Record<string, Record<number, number>>>({});
  const [sel, setSel] = useState<{ section: string; index: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const drag = useRef<CueMarker | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  const bridge = state?.bridge;
  const active = bridge?.tabs.find(t => t.active)?.path || "";
  const desktop = hasDesktopEngine();

  // Peaks of the song that is loaded; a song that is still loading answers with an empty list, so try again shortly
  useEffect(() => {
    if (!desktop || !active) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = (tries: number) => {
      engineCall("/peaks")
        .then((d: Peaks) => {
          if (stop) return;
          if (d?.path === active && d.peaks?.length) setData(d);
          else if (tries < 8) timer = setTimeout(() => load(tries + 1), 1000);
        })
        .catch(() => { if (!stop && tries < 8) timer = setTimeout(() => load(tries + 1), 1500); });
    };
    load(0);
    return () => { stop = true; clearTimeout(timer); };
  }, [desktop, active]);

  const loadTiming = useCallback(async () => {
    try {
      const res = await fetch(`/api/reaper/arrangement/timing?path=${encodeURIComponent(active)}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error || `HTTP ${res.status}`);
      setTiming({ sections: json.sections || [], lead: typeof json.lead === "number" ? json.lead : 2 });
      setTimingError(json.sections?.some((x: TimingSection) => x.slides.length) ? "" : "Dit nummer heeft nog geen FreeShow-tekst (koppel de tekst bij het nummer in de setlist).");
      setEdits({});
    } catch (err) {
      setTiming(null);
      setTimingError(err instanceof Error ? err.message : "Laden mislukt");
    }
  }, [active]);

  useEffect(() => {
    if (cueMode && active) loadTiming();
  }, [cueMode, active, loadTiming]);
  useEffect(() => { setSel(null); setEdits({}); }, [active]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.floor(el.clientWidth)));
    ro.observe(el);
    setWidth(Math.floor(el.clientWidth));
    return () => ro.disconnect();
  }, [data]);

  const show = data && data.path === active ? data : null;
  const total = show?.total || 0;
  const canvasH = cueMode ? HEIGHT + LANE : HEIGHT;
  const beatTimes = show?.beats;
  const markers = React.useMemo<CueMarker[]>(
    () => (cueMode && timing && beatTimes && beatTimes.length > 1 ? buildMarkers(timing.sections, state?.regions || [], beatTimes, timing.lead, edits) : []),
    [cueMode, timing, beatTimes, state?.regions, edits],
  );

  const draw = useCallback(() => {
    const cv = canvas.current;
    const st = state;
    if (!cv || !show || !width || !st) return;
    const dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(width * dpr) || cv.height !== Math.round(canvasH * dpr)) {
      cv.width = Math.round(width * dpr);
      cv.height = Math.round(canvasH * dpr);
    }
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, canvasH);

    const xOf = (t: number) => (t / total) * width;
    const mid = LABEL_H + (HEIGHT - LABEL_H) / 2;
    const amp = (HEIGHT - LABEL_H) / 2 - 3;

    // position: between two updates the playhead keeps moving
    const playing = st.playState === 1;
    const pos = Math.min(total, st.position + (playing && st.receivedAt ? Math.min(1, (Date.now() - st.receivedAt) / 1000) : 0));
    const px = xOf(pos);

    const regions = st.regions;
    const b = st.bridge;
    const current = b?.region ?? regions.find(r => pos >= r.start && pos < r.end)?.id;

    // sections: a tinted band with the name above it
    ctx.font = "600 11px system-ui, sans-serif";
    ctx.textBaseline = "middle";
    for (const r of regions) {
      const x0 = xOf(r.start), x1 = xOf(Math.min(r.end, total));
      const col = sectionColor(r.name);
      const a0 = x0 + GAP / 2, a1 = x1 - GAP / 2, w = Math.max(1, a1 - a0);
      ctx.fillStyle = col + (r.id === current ? "50" : "28");
      ctx.fillRect(a0, 0, w, HEIGHT);
      ctx.fillStyle = col;
      ctx.fillRect(a0, 0, w, 4);
      if (r.id === b?.pending) {
        ctx.save();
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(a0 + 1, 1, Math.max(0, w - 2), HEIGHT - 2);
        ctx.restore();
      }
      const loop = r.id === b?.loop ? "⟲ " : "";
      const room = w - 8;
      const label = [loop + r.name, loop + shortName(r.name)].find(t => ctx.measureText(t).width <= room);
      if (label) {
        ctx.fillStyle = "#f1f5f9";
        ctx.fillText(label, a0 + 4, LABEL_H / 2 + 2);
      }
    }

    // waveform: the peak per block as a mirrored bar, the effective value inside it (the part that has been played is brighter)
    const n = show.peaks.length;
    const rmsTop = Math.max(1, ...show.rms);
    for (let x = 0; x < width; x++) {
      const i0 = Math.floor((x / width) * n), i1 = Math.max(i0 + 1, Math.floor(((x + 1) / width) * n));
      let p = 0, r = 0;
      for (let i = i0; i < i1 && i < n; i++) { if (show.peaks[i] > p) p = show.peaks[i]; if (show.rms[i] > r) r = show.rms[i]; }
      const played = x < px;
      const hp = (p / 255) * amp, hr = (r / rmsTop) * amp * 0.8;
      ctx.fillStyle = played ? "rgba(226,232,240,0.55)" : "rgba(148,163,184,0.45)";
      ctx.fillRect(x, mid - hp, 1, Math.max(1, hp * 2));
      ctx.fillStyle = played ? "rgba(248,250,252,0.95)" : "rgba(203,213,225,0.8)";
      ctx.fillRect(x, mid - hr, 1, Math.max(1, hr * 2));
    }

    // bar grid: ticks for the beats and bars, the bar number every so many bars (as many as fit)
    const bars = show.bars || [], beats = show.beats || [];
    if (bars.length > 1) {
      const barPx = (xOf(bars[bars.length - 1]) - xOf(bars[0])) / (bars.length - 1);
      if (beats.length && barPx / 4 >= 5) {
        ctx.fillStyle = "rgba(226,232,240,0.18)";
        for (const t of beats) ctx.fillRect(Math.round(xOf(t)), HEIGHT - 5, 1, 5);
      }
      if (barPx >= 3) {
        const every = [1, 2, 4, 8, 16, 32].find(n => barPx * n >= 34) || 32;
        ctx.font = "500 9px system-ui, sans-serif";
        ctx.textBaseline = "alphabetic";
        bars.forEach((t, i) => {
          const x = Math.round(xOf(t));
          const numbered = i % every === 0;
          ctx.fillStyle = numbered ? "rgba(226,232,240,0.45)" : "rgba(226,232,240,0.28)";
          ctx.fillRect(x, HEIGHT - (numbered ? 12 : 8), 1, numbered ? 12 : 8);
          if (numbered && x + 3 < width - 24) { ctx.fillStyle = "rgba(226,232,240,0.7)"; ctx.fillText(String(i + 1), x + 3, HEIGHT - 3); }
        });
        ctx.textBaseline = "middle";
      }
    }

    // FreeShow slides: a lane under the waveform with a numbered flag per slide (full = own moment, hollow = estimate by text length)
    if (cueMode) {
      ctx.fillStyle = "rgba(15,23,42,0.65)";
      ctx.fillRect(0, HEIGHT, width, LANE);
      ctx.font = "700 10px system-ui, sans-serif";
      ctx.textBaseline = "middle";
      ctx.textAlign = "center";
      for (const m of markers) {
        const x = Math.round(xOf(m.t));
        const col = sectionColor(m.section);
        const selected = sel?.section === m.section && sel.index === m.index;
        ctx.fillStyle = selected ? "rgba(255,255,255,0.55)" : "rgba(226,232,240,0.18)";
        ctx.fillRect(x, LABEL_H, 1, HEIGHT - LABEL_H);
        const cy = HEIGHT + LANE / 2;
        ctx.beginPath();
        ctx.arc(x, cy, 9, 0, Math.PI * 2);
        if (m.manual || m.fixed) { ctx.fillStyle = col; ctx.fill(); } else { ctx.fillStyle = "rgba(15,23,42,0.9)"; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = col; ctx.stroke(); }
        if (selected) { ctx.lineWidth = 2; ctx.strokeStyle = "#fff"; ctx.beginPath(); ctx.arc(x, cy, 11, 0, Math.PI * 2); ctx.stroke(); }
        ctx.fillStyle = m.manual || m.fixed ? "#0b1222" : "#f1f5f9";
        ctx.fillText(String(m.index), x, cy + 0.5);
      }
      ctx.textAlign = "start";
    }

    // playhead
    ctx.fillStyle = "#fff";
    ctx.fillRect(Math.round(px) - 1, 0, 2, canvasH);
    ctx.beginPath();
    ctx.moveTo(px - 5, 0);
    ctx.lineTo(px + 5, 0);
    ctx.lineTo(px, 7);
    ctx.closePath();
    ctx.fill();
  }, [show, width, total, state, cueMode, markers, sel, canvasH]);

  // Redraw: often while playing (smooth playhead), otherwise when something changes
  useEffect(() => {
    draw();
    if (state?.playState !== 1) return;
    const t = setInterval(draw, 66);
    return () => clearInterval(t);
  }, [draw, state]);

  const at = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const t = (x / rect.width) * total;
    return { x, t, region: state?.regions.find(r => t >= r.start && t < r.end) };
  };

  const markerAt = (e: React.PointerEvent<HTMLCanvasElement>): CueMarker | undefined => {
    if (!cueMode || !total) return undefined;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    if (y < HEIGHT) return undefined;
    let best: CueMarker | undefined, dist = 12;
    for (const m of markers) { const d = Math.abs((m.t / total) * rect.width - x); if (d < dist) { dist = d; best = m; } }
    return best;
  };

  const sectionOf = (name: string) => timing?.sections.find(x => x.name === name);

  const saveSection = async (name: string, atBeats: Record<number, number> | null) => {
    setSaving(true);
    try {
      const res = await fetch("/api/reaper/arrangement/timing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: active, name, at: atBeats }),
      });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error || `HTTP ${res.status}`);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Opslaan mislukt");
    } finally {
      await loadTiming();
      setSaving(false);
    }
  };

  const seek = async (t: number) => {
    try { await reaperAction({ action: "seek", pos: Math.max(0, t) }); } catch (err) { onError(err instanceof Error ? err.message : "Actie mislukt"); }
  };

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const m = markerAt(e);
    if (!m) return;
    setSel({ section: m.section, index: m.index });
    if (m.fixed || saving) return;
    drag.current = m;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { x, t, region } = at(e);
    const d = drag.current;
    if (d && beatTimes) {
      const s = sectionOf(d.section);
      if (s) setEdits({ [d.section]: placeSlide(s, {}, d.index, qnOfSec(beatTimes, t) - d.startQn) });
      return;
    }
    const m = markerAt(e);
    const bars = show?.bars || [];
    let bar = 0;
    while (bar + 1 < bars.length && bars[bar + 1] <= t) bar++;
    setTip({ x, text: m ? `${m.section} · dia ${m.index}${m.text ? ": " + m.text : ""}` : `${region ? region.name + " · " : ""}${formatTime(t)}${bars.length ? " · maat " + (bar + 1) : ""}` });
  };

  const onUp = async (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (d) {
      drag.current = null;
      const moved = edits[d.section];
      if (moved) await saveSection(d.section, moved);
      return;
    }
    if (cueMode) {
      if (!markerAt(e)) { const { t } = at(e); await seek(t); }   // placing slides: a click on the waveform puts the playhead there
      return;
    }
    await onClick(e);
  };

  // The slide that is selected, or (if none) the first movable slide of the section under the playhead
  const target = (): { section: TimingSection; index: number } | null => {
    if (!timing) return null;
    const pos = state?.position ?? 0;
    const name = sel?.section ?? state?.regions.find(r => pos >= r.start && pos < r.end)?.name;
    const s = name ? sectionOf(name) : undefined;
    if (!s) return null;
    const index = sel?.index ?? s.slides.find(x => !x.fixed)?.index;
    return index ? { section: s, index } : null;
  };

  const placeHere = async () => {
    const tg = target();
    if (!tg || !beatTimes) { onError("Kies eerst een dia op de golfvorm"); return; }
    const sl = tg.section.slides.find(x => x.index === tg.index);
    if (!sl || sl.fixed) { onError("De eerste dia van een sectie komt vanzelf en kan niet verplaatst worden"); return; }
    const pos = state?.position ?? 0;
    const region = state?.regions.find(r => r.name === tg.section.name && pos >= r.start && pos < r.end);
    if (!region) { onError(`De speelkop staat niet in "${tg.section.name}"`); return; }
    const beat = qnOfSec(beatTimes, pos) - qnOfSec(beatTimes, region.start);
    await saveSection(tg.section.name, placeSlide(tg.section, {}, tg.index, beat));
    const next = tg.section.slides.find(x => x.index === tg.index + 1);
    setSel(next ? { section: tg.section.name, index: next.index } : null);   // on to the next slide of this section
  };

  const stepMarker = async (dir: -1 | 1) => {
    const pos = state?.position ?? 0;
    const list = [...markers].sort((a, b) => a.t - b.t);
    const m = dir < 0 ? [...list].reverse().find(x => x.t < pos - 0.3) : list.find(x => x.t > pos + 0.3);
    if (!m) return;
    setSel({ section: m.section, index: m.index });
    await seek(m.t);
  };

  const resetSection = async () => {
    const tg = target();
    if (!tg) return;
    if (!confirm(`De timing van "${tg.section.name}" terugzetten naar de schatting (naar tekstlengte)?`)) return;
    await saveSection(tg.section.name, null);
  };

  const onClick = async (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { region } = at(e);
    const current = bridge?.region ?? state?.regions.find(r => state.position >= r.start && state.position < r.end)?.id;
    if (!region || region.id === current) return;   // a click inside the section that is playing does nothing
    try {
      await reaperAction({ action: "jump", region: region.id, mode: bridge?.mode || "end" });
    } catch (err) {
      onError(err instanceof Error ? err.message : "Actie mislukt");
    }
  };

  if (!desktop || !show) return null;

  const selMarker = sel ? markers.find(m => m.section === sel.section && m.index === sel.index) : undefined;

  return (
    <div className={`trk-wave${stage ? " stage" : ""}`} ref={box} role="group" aria-label="Golfvorm van het nummer met de secties">
      <canvas
        ref={canvas}
        style={{ width: "100%", height: canvasH, touchAction: cueMode ? "none" : undefined }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerLeave={() => setTip(null)}
        onPointerUp={onUp}
        title={cueMode ? "Sleep een dia naar een ander moment, of klik op de golfvorm om de speelkop daar te zetten" : "Tik op een sectie om ernaartoe te springen (volgens het sprongmoment hieronder)"}
      />
      <button className={`trk-wave-cuebtn${cueMode ? " on" : ""}`} onClick={() => setCueMode(v => !v)} aria-pressed={cueMode}
        title="De FreeShow-dia's op de golfvorm plaatsen">Dia&apos;s</button>
      {tip && <span className="trk-wave-tip" style={{ left: Math.min(Math.max(tip.x, 40), Math.max(40, width - 40)) }}>{tip.text}</span>}
      <span className="trk-wave-time" style={{ top: canvasH - 20, bottom: "auto" }}>{formatTime(total)}</span>
      {cueMode && (
        <div className="trk-wave-bar">
          {timingError ? <span className="trk-meta">{timingError}</span> : (
            <>
              <button className="trk-icon-btn" onClick={() => stepMarker(-1)} title="Naar de vorige dia">◀ Vorige</button>
              <button className="trk-icon-btn pinned" onClick={placeHere} disabled={saving} title="Zet de gekozen dia op het moment van de speelkop; daarna is de volgende dia gekozen">
                Zet dia {target()?.index ?? ""} hier
              </button>
              <button className="trk-icon-btn" onClick={() => stepMarker(1)} title="Naar de volgende dia">Volgende ▶</button>
              <span className="trk-meta trk-wave-seltext">
                {selMarker ? `${selMarker.section} · dia ${selMarker.index}${selMarker.text ? ": " + selMarker.text : ""}` : "Klik een dia op de golfvorm, zet de speelkop op het moment en tik op \u201cZet dia hier\u201d. Sleep een dia om hem te verschuiven."}
              </span>
              <button className="trk-icon-btn" onClick={resetSection} disabled={saving} title="De timing van deze sectie terugzetten naar de schatting">Herstel schatting</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
