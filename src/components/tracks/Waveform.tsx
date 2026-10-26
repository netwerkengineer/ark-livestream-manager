"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import type { ReaperState } from "@/lib/reaperControl";
import { engineCall, hasDesktopEngine } from "@/lib/desktopEngine";
import { reaperAction, formatTime } from "./useReaper";
import { sectionColor } from "./songName";

// Waveform of the whole song with the sections on it, the playhead, and a click to jump to a section (with the jump mode that is set).
// The peaks come from the app's own player (/peaks): with REAPER as the player there is no waveform and nothing is shown here.

interface Peaks { rate: number; total: number; path: string; peaks: number[]; rms: number[] }

interface WaveformProps {
  state: ReaperState | null;
  onError: (message: string) => void;
  stage?: boolean;
}

const HEIGHT = 104;
const LABEL_H = 18;

export default function Waveform({ state, onError, stage }: WaveformProps) {
  const [data, setData] = useState<Peaks | null>(null);
  const [width, setWidth] = useState(0);
  const [tip, setTip] = useState<{ x: number; text: string } | null>(null);
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

  const draw = useCallback(() => {
    const cv = canvas.current;
    const st = state;
    if (!cv || !show || !width || !st) return;
    const dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(width * dpr) || cv.height !== Math.round(HEIGHT * dpr)) {
      cv.width = Math.round(width * dpr);
      cv.height = Math.round(HEIGHT * dpr);
    }
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, HEIGHT);

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
      ctx.fillStyle = col + (r.id === current ? "40" : "22");
      ctx.fillRect(x0, 0, x1 - x0, HEIGHT);
      ctx.fillStyle = col;
      ctx.fillRect(x0, 0, x1 - x0, 3);
      if (r.id === b?.pending) {
        ctx.save();
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x0 + 1, 1, Math.max(0, x1 - x0 - 2), HEIGHT - 2);
        ctx.restore();
      }
      if (x1 - x0 > 26) {
        ctx.fillStyle = "#e2e8f0";
        const label = (r.id === b?.loop ? "⟲ " : "") + r.name;
        ctx.save();
        ctx.beginPath();
        ctx.rect(x0, 0, x1 - x0 - 2, LABEL_H);
        ctx.clip();
        ctx.fillText(label, x0 + 5, LABEL_H / 2 + 1);
        ctx.restore();
      }
      ctx.fillStyle = "rgba(255,255,255,0.25)";
      ctx.fillRect(x0, 0, 1, HEIGHT);
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

    // playhead
    ctx.fillStyle = "#fff";
    ctx.fillRect(Math.round(px) - 1, 0, 2, HEIGHT);
    ctx.beginPath();
    ctx.moveTo(px - 5, 0);
    ctx.lineTo(px + 5, 0);
    ctx.lineTo(px, 7);
    ctx.closePath();
    ctx.fill();
  }, [show, width, total, state]);

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

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { x, t, region } = at(e);
    setTip({ x, text: `${region ? region.name + " · " : ""}${formatTime(t)}` });
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

  return (
    <div className={`trk-wave${stage ? " stage" : ""}`} ref={box} role="group" aria-label="Golfvorm van het nummer met de secties">
      <canvas
        ref={canvas}
        style={{ width: "100%", height: HEIGHT }}
        onPointerMove={onMove}
        onPointerLeave={() => setTip(null)}
        onPointerUp={onClick}
        title="Tik op een sectie om ernaartoe te springen (volgens het sprongmoment hieronder)"
      />
      {tip && <span className="trk-wave-tip" style={{ left: Math.min(Math.max(tip.x, 40), Math.max(40, width - 40)) }}>{tip.text}</span>}
      <span className="trk-wave-time">{formatTime(total)}</span>
    </div>
  );
}
