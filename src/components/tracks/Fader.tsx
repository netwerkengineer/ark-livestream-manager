"use client";

import React, { useRef } from "react";
import { dbToFader, UNITY } from "./faderLaw";

interface FaderProps {
  value: number;                                  // 0..1, X32 fader law
  onChange: (value: number, final: boolean) => void;
  meter: number;                                  // 0..100 %
  label: string;
  bus?: boolean;
}

const SCALE = [10, 5, 0, -5, -10, -20, -30, -40, -60];
const clamp = (v: number) => Math.max(0, Math.min(1, v));

// A vertical fader like on a mixing desk: grab the cap and slide it up or
// down (relative, so it doesn't jump); tapping the groove moves the cap
// there. Double-click / double-tap = 0 dB, arrow keys for fine steps.
export default function Fader({ value, onChange, meter, label, bus }: FaderProps) {
  const groove = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startY: number; startValue: number; value: number } | null>(null);
  const lastTap = useRef(0);

  const travel = () => groove.current?.getBoundingClientRect().height || 1;

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const now = Date.now();
    if (now - lastTap.current < 300) {
      lastTap.current = 0;
      drag.current = null;
      onChange(UNITY, true);
      return;
    }
    lastTap.current = now;
    let start = value;
    if (!(e.target as HTMLElement).closest(".mx-cap")) {
      const rect = groove.current!.getBoundingClientRect();
      start = clamp(1 - (e.clientY - rect.top) / rect.height);
      onChange(start, false);
    }
    drag.current = { startY: e.clientY, startValue: start, value: start };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    // Shift = fine control
    const scale = e.shiftKey ? 0.25 : 1;
    d.value = clamp(d.startValue + ((d.startY - e.clientY) / travel()) * scale);
    onChange(d.value, false);
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d) onChange(d.value, true);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 0.05 : 0.01;
    if (e.key === "ArrowUp") onChange(clamp(value + step), true);
    else if (e.key === "ArrowDown") onChange(clamp(value - step), true);
    else if (e.key === "Home" || e.key === "0") onChange(UNITY, true);
    else return;
    e.preventDefault();
  };

  return (
    <div className={`mx-fader${bus ? " bus" : ""}`}>
      <div className="mx-scale" aria-hidden>
        {SCALE.map(db => (
          <span key={db} className={db === 0 ? "unity" : ""} style={{ bottom: `${dbToFader(db) * 100}%` }}>
            {db > 0 ? `+${db}` : db}
          </span>
        ))}
        <span style={{ bottom: 0 }}>-∞</span>
      </div>
      <div
        className="mx-groove-area"
        role="slider"
        tabIndex={0}
        aria-label={`${label} volume`}
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={Math.round(value * 100) / 100}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        title="Schuif de knop; dubbeltik = 0 dB"
      >
        <div className="mx-groove" ref={groove}>
          <div className="mx-unity-line" style={{ bottom: `${UNITY * 100}%` }} />
          <div className="mx-cap" style={{ bottom: `${value * 100}%` }}><i /></div>
        </div>
      </div>
      <div className="mx-meter" aria-hidden><div style={{ height: `${meter}%` }} /></div>
    </div>
  );
}
