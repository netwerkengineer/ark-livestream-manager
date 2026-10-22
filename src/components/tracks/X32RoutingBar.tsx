"use client";

import React, { useCallback, useEffect, useState } from "react";
import { reaperAction } from "./useReaper";

interface Props {
  /** een opname staat klaar om af te spelen (alleen dan mag de X32 op PLAY) */
  klaar: boolean;
  /** er speelt nu iets in REAPER */
  playing: boolean;
  onError: (message: string) => void;
  onStatus: (message: string) => void;
}

type Mode = "REC" | "PLAY";

// Stand van de X32 (REC/PLAY) voor de virtuele soundcheck. In PLAY nemen de kanalen hun ingang van de computer
// in plaats van van de microfoons: tijdens een dienst moet de tafel dus op REC staan.
export default function X32RoutingBar({ klaar, playing, onError, onStatus }: Props) {
  const [mode, setMode] = useState<Mode | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const lees = useCallback(async () => {
    try {
      const res = await fetch("/api/x32/routing", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
      setMode(data.mode);
      setFout(null);
    } catch (err) {
      setMode(null);
      setFout(err instanceof Error ? err.message : "X32 niet bereikbaar");
    }
  }, []);

  useEffect(() => {
    lees();
    const t = setInterval(() => { if (!document.hidden) lees(); }, 5000);
    return () => clearInterval(t);
  }, [lees]);

  const zet = async (nieuw: Mode) => {
    if (nieuw === "PLAY" && !confirm("De X32 op PLAY zetten?\n\nAlle kanalen luisteren dan naar de opname op de computer en niet meer naar de microfoons en instrumenten. Zet hem na afloop weer op REC.")) return;
    setBusy(true);
    try {
      await reaperAction({ mode: nieuw }, "/api/x32/routing");
      onStatus(nieuw === "PLAY" ? "X32 staat op PLAY" : "X32 staat weer op REC");
      await lees();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Omzetten mislukt");
    } finally {
      setBusy(false);
    }
  };

  if (mode === "PLAY") {
    return (
      <div style={{ marginTop: 10, padding: "8px 12px", borderRadius: 8, background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.5)",
        display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ flex: "1 1 260px" }}>
          <b>X32 staat op PLAY</b>: de kanalen horen de computer, niet de microfoons. Zet hem voor de dienst weer op REC.
        </span>
        <button className="trk-load" disabled={busy} onClick={() => zet("REC")}>Terug naar REC</button>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
      <span style={{ flex: "1 1 260px", opacity: 0.85 }}>
        {mode === "REC" ? "X32: REC (normaal, de kanalen horen de microfoons)" : `X32: niet bereikbaar${fout ? ` (${fout})` : ""}`}
      </span>
      <button className="trk-load" disabled={busy || mode !== "REC" || !klaar || playing}
        title={!klaar ? "Zet eerst een opname klaar" : playing ? "Stop eerst het afspelen" : "De kanalen laten luisteren naar de opname"}
        onClick={() => zet("PLAY")}>
        Console op PLAY zetten
      </button>
    </div>
  );
}
