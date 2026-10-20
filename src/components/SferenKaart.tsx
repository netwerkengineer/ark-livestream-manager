"use client";

import React, { useEffect, useState } from "react";

// Voorbeeld van de kleuren per sfeer (zoals de lampen ze ongeveer krijgen) en een knop om een sfeer met de hand te proberen.
interface Sfeer { slug: string; naam: string; kleur: string; accent: string; wit: number }

function tint(hex: string, w: number): string {
  const h = hex.replace("#", "");
  const c = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
  return "#" + c.map(v => Math.round(v + (255 - v) * w).toString(16).padStart(2, "0")).join("");
}

export default function SferenKaart({ onStatus }: { onStatus?: (kind: "success" | "error", text: string) => void }) {
  const [sferen, setSferen] = useState<Sfeer[]>([]);
  const [actief, setActief] = useState<string[]>([]);
  const [bezig, setBezig] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/sferen").then(r => r.ok ? r.json() : null).then(d => { if (d?.sferen) setSferen(d.sferen); }).catch(() => {});
  }, []);
  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const res = await fetch("/api/lights/auto", { cache: "no-store" });
        if (res.ok && !stop) { const d = await res.json(); setActief(d.palet || []); }
      } catch { /* geen Companion/QLC+ bereikbaar */ }
    };
    load();
    const timer = setInterval(load, 5000);
    return () => { stop = true; clearInterval(timer); };
  }, []);

  const start = async (slug: string, naam: string) => {
    setBezig(slug);
    try {
      const res = await fetch("/api/lights/sfeer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug }) });
      const d = await res.json();
      if (!res.ok || !d.success) throw new Error(d.error || "mislukt");
      onStatus?.("success", slug === "uit" ? "Sfeer uitgezet." : `Sfeer gestart: ${naam}`);
      if (slug === "uit") setActief([]); else setActief([naam]);
    } catch (e: any) {
      onStatus?.("error", `Sfeer starten mislukt: ${e.message}`);
    } finally {
      setBezig(null);
    }
  };

  if (sferen.length === 0) return null;
  return (
    <section className="glass-card" style={{ padding: "16px 24px", marginBottom: "24px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px", flexWrap: "wrap", gap: "8px" }}>
        <strong style={{ fontSize: "0.95rem" }}>Sferen: kleurvoorbeeld per lied</strong>
        <button onClick={() => start("uit", "")} disabled={bezig !== null} className="btn-group-action off" style={{ padding: "4px 12px", fontSize: "0.75rem", borderColor: "rgba(239,68,68,0.4)", color: "#fca5a5" }}>
          SFEER UIT
        </button>
      </div>
      <p style={{ fontSize: "0.78rem", opacity: 0.65, margin: "0 0 12px" }}>
        Per sfeer drie kleuren: de hoofdkleur (SlimPARs en ADJ-bar), de accentkleur (lightmaXX-bars) en wit (KLS-200, voor de keys). Het is een benadering van wat de lampen krijgen. Klik op een sfeer om hem met de hand te proberen.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: "10px" }}>
        {sferen.map(s => {
          const isActief = actief.includes(s.naam);
          return (
            <button
              key={s.slug}
              onClick={() => start(s.slug, s.naam)}
              disabled={bezig !== null}
              title={`Sfeer ${s.naam} starten`}
              style={{ textAlign: "left", cursor: "pointer", padding: "8px", borderRadius: "10px", color: "inherit", background: "rgba(255,255,255,0.03)", border: isActief ? "2px solid #fff" : "1px solid rgba(255,255,255,0.1)", opacity: bezig && bezig !== s.slug ? 0.6 : 1 }}
            >
              <div style={{ display: "flex", gap: "4px", marginBottom: "6px" }}>
                <span style={{ flex: 2, height: "34px", borderRadius: "6px", background: tint(s.kleur, s.wit) }} />
                <span style={{ flex: 1, height: "34px", borderRadius: "6px", background: tint(s.accent, s.wit) }} />
                <span style={{ flex: 1, height: "34px", borderRadius: "6px", background: "#ffffff" }} />
              </div>
              <div style={{ fontSize: "0.82rem", fontWeight: 600 }}>
                {s.naam}{isActief ? " ● actief" : ""}
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
