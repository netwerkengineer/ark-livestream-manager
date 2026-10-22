"use client";

import React, { useEffect, useRef, useState } from "react";

// Keuzelijst voor een sfeer met kleurvoorbeeld per optie (een gewone <select> kan geen kleurvlakjes tonen).
export interface SfeerOptie { slug: string; naam: string; kleur: string; accent?: string; wit?: number }

function tint(hex: string, w = 0): string {
  const h = hex.replace("#", "");
  const c = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
  return "#" + c.map(v => Math.round(v + (255 - v) * w).toString(16).padStart(2, "0")).join("");
}

function Vlak({ s, breed }: { s: SfeerOptie; breed: number }) {
  // hoofdkleur (met wit) links, accentkleur rechts
  return (
    <span style={{ display: "inline-flex", width: breed, height: Math.round(breed * 0.55), borderRadius: 5, overflow: "hidden", flexShrink: 0, border: "1px solid rgba(255,255,255,0.25)" }}>
      <span style={{ flex: 2, background: tint(s.kleur, s.wit || 0) }} />
      <span style={{ flex: 1, background: tint(s.accent || s.kleur, s.wit || 0) }} />
    </span>
  );
}

export default function SfeerKiezer({ value, opties, onChange, titel = "Sfeer: achtergrond en licht bij dit lied (blijft op het lied staan)", leegLabel = "Sfeer: zoals nu", leegKeuze = "Zoals in het lied laten" }: {
  value: string; opties: SfeerOptie[]; onChange: (slug: string) => void;
  /** tooltip en teksten; met leegKeuze={null} ontbreekt de keuze "niets kiezen" */
  titel?: string; leegLabel?: string; leegKeuze?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const sluit = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", sluit);
    return () => document.removeEventListener("mousedown", sluit);
  }, [open]);

  const gekozen = opties.find(o => o.slug === value);
  const knop: React.CSSProperties = { display: "flex", alignItems: "center", gap: "8px", width: "100%", textAlign: "left", cursor: "pointer", color: "inherit", background: "transparent", border: "none", padding: "5px 8px", fontSize: "0.78rem" };
  return (
    <div ref={ref} style={{ position: "relative" }} title={titel}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{ ...knop, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 6, minWidth: "9.5rem" }}
      >
        {gekozen ? <Vlak s={gekozen} breed={34} /> : <span style={{ width: 34, height: 19, borderRadius: 5, border: "1px dashed rgba(255,255,255,0.35)", flexShrink: 0 }} />}
        <span style={{ flex: 1, whiteSpace: "nowrap" }}>{gekozen ? gekozen.naam : leegLabel}</span>
        <span style={{ opacity: 0.6, fontSize: "0.65rem" }}>▾</span>
      </button>
      {open && (
        <div style={{ position: "absolute", right: 0, top: "calc(100% + 4px)", zIndex: 50, minWidth: "13rem", background: "#0f172a", border: "1px solid rgba(255,255,255,0.18)", borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,0.5)", padding: 4, maxHeight: "22rem", overflowY: "auto" }}>
          {leegKeuze !== null && (
            <button type="button" style={knop} onClick={() => { onChange(""); setOpen(false); }}>
              <span style={{ width: 44, height: 24, borderRadius: 5, border: "1px dashed rgba(255,255,255,0.35)", flexShrink: 0 }} />
              <span style={{ opacity: 0.8 }}>{leegKeuze}</span>
            </button>
          )}
          {opties.map(o => (
            <button key={o.slug} type="button" style={{ ...knop, background: o.slug === value ? "rgba(255,255,255,0.1)" : "transparent" }} onClick={() => { onChange(o.slug); setOpen(false); }}>
              <Vlak s={o} breed={44} />
              <span>{o.naam}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
