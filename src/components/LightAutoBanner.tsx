"use client";

import React, { useEffect, useState } from "react";

// Overzicht boven de lichtregie: wat stuurt QLC+ nu, wie startte het (automatisch via FreeShow/Companion of met de hand),
// de schakelaar "automatisch licht" en een waarschuwing als die uit staat. Gebruikt op de Licht-tab en op /lights.
interface Props {
  autoCount: number;      // kleurkeuzes die automatisch draaien (functie zonder knop)
  manualCount: number;    // kleurkeuzes die met een knop zijn gestart
  sceneActive: boolean;   // hoofdscène, lichtshow of stroboscoop actief
  onStatus?: (kind: "success" | "error", text: string) => void;
}

interface AutoLight { available: boolean; auto: string; kleur: string; tijd: string; palet?: string[] }

export default function LightAutoBanner({ autoCount, manualCount, sceneActive, onStatus }: Props) {
  const [autoLight, setAutoLight] = useState<AutoLight | null>(null);

  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const res = await fetch("/api/lights/auto", { cache: "no-store" });
        if (res.ok && !stop) setAutoLight(await res.json());
      } catch { /* Companion niet bereikbaar: blok blijft verborgen */ }
    };
    load();
    const timer = setInterval(load, 5000);
    return () => { stop = true; clearInterval(timer); };
  }, []);

  const handleSwitch = async (next: "aan" | "uit") => {
    setAutoLight(prev => prev ? { ...prev, auto: next } : prev);
    try {
      const res = await fetch("/api/lights/auto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auto: next }),
      });
      if (!res.ok) throw new Error("mislukt");
      onStatus?.("success", next === "aan" ? "Automatisch licht staat aan (FreeShow mag het licht sturen)." : "Automatisch licht staat uit (FreeShow doet niets met het licht).");
    } catch {
      onStatus?.("error", "Kon de schakelaar voor automatisch licht niet instellen.");
    }
  };

  const paletN = autoLight?.palet?.length || 0;
  const nothing = autoCount === 0 && manualCount === 0 && !sceneActive && paletN === 0;

  return (
    <section className="glass-card" style={{ padding: "16px 24px", marginBottom: "24px", display: "flex", flexWrap: "wrap", gap: "16px 24px", alignItems: "center", justifyContent: "space-between" }}>
      {autoLight?.available && autoLight.auto === "uit" && (
        <div style={{ flexBasis: "100%", background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.5)", color: "#fca5a5", borderRadius: "8px", padding: "8px 12px", fontSize: "0.85rem" }}>
          ⚠️ <strong>Automatisch licht staat UIT.</strong> FreeShow en Companion sturen nu geen licht aan: de lichtacties bij de liederen doen niets. Zet de schakelaar rechts op AAN om ze weer te laten werken.
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "0.9rem" }}>
        <strong>Wat stuurt QLC+ nu?</strong>
        {nothing ? (
          <span style={{ color: "var(--muted)" }}>Niets. Brandt er toch licht, dan komt dat van de ADJ Scene Setter (QLC+ ziet de schuiven daarvan niet).</span>
        ) : (
          <span>
            {autoCount > 0 && <>Automatisch (FreeShow): <strong>{autoCount}</strong> kleurkeuze(s) &nbsp;</>}
            {paletN > 0 && <>Kleurenschema (automatisch): <strong>{autoLight?.palet?.join(", ")}</strong> &nbsp;</>}
            {manualCount > 0 && <>Handmatig (knop): <strong>{manualCount}</strong> kleurkeuze(s) &nbsp;</>}
            {sceneActive && <>Scène of lichtshow actief &nbsp;</>}
            <span style={{ color: "var(--muted)" }}>De Scene Setter staat hier los van: de hoogste waarde wint.</span>
          </span>
        )}
        {autoLight?.available && autoLight.kleur && (
          <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>Laatste automatische wissel: {autoLight.kleur} om {autoLight.tijd}. Een los kleurbolletje met een gestippelde rand is automatisch gestart; een sfeer heeft geen bolletje, die zie je hierboven en in de kaart Sferen.</span>
        )}
      </div>
      {autoLight?.available && (
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={{ fontSize: "0.85rem" }}>Automatisch licht (FreeShow)</span>
          <button
            onClick={() => handleSwitch(autoLight.auto === "aan" ? "uit" : "aan")}
            className="btn-group-action off"
            style={{ padding: "6px 14px", fontSize: "0.8rem", borderColor: autoLight.auto === "aan" ? "rgba(74,222,128,0.5)" : "rgba(239,68,68,0.5)", color: autoLight.auto === "aan" ? "#86efac" : "#fca5a5" }}
          >
            {autoLight.auto === "aan" ? "AAN" : "UIT"}
          </button>
        </div>
      )}
    </section>
  );
}
