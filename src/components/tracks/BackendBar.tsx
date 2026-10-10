"use client";

import React, { useState, useEffect, useCallback } from "react";
import { MonitorSmartphone, Server, Users, AlertTriangle } from "lucide-react";

interface LinkStatus {
  backend: "reaper" | "desktop";
  chosen: string | null;
  player: { id: string; name: string; online: boolean; seenAgoMs?: number | null; maxGapMs?: number; reports?: number } | null;
  players: { id: string; name: string; online: boolean }[];
  controllers: { user: string; device: string }[];
  last: { user: string; device: string; action: string; at: number; ms?: number | null } | null;
}

interface Props { onError: (m: string) => void; onStatus: (m: string) => void }

// Which player the web app controls (REAPER on the track computer, or a desktop app), who is connected,
// and the deliberate switch between them. There is no automatic fall-back to REAPER: a second source
// could start playing while the app is still going.
export default function BackendBar({ onError, onStatus }: Props) {
  const [s, setS] = useState<LinkStatus | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/desktop-link", { cache: "no-store" });
      if (res.ok) setS(await res.json());
    } catch { /* the stream shows connection problems itself */ }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, 4000);
    return () => clearInterval(t);
  }, [load]);

  const switchTo = async (backend: "reaper" | "desktop", player?: string) => {
    const name = backend === "reaper" ? "REAPER (track-computer)" : s?.players.find(p => p.id === player)?.name || "de desktop-app";
    if (!confirm(`De bediening overzetten naar ${name}? Het geluid komt dan van die speler. Zorg dat de andere speler stil staat.`)) return;
    try {
      const res = await fetch("/api/desktop-link", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ backend, player }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Overzetten mislukt");
      setS(data);
      onStatus(backend === "reaper" ? "Bediening staat op REAPER." : "Bediening staat op de desktop-app.");
    } catch (err) {
      onError(err instanceof Error ? err.message : "Overzetten mislukt");
    }
  };

  if (!s) return null;
  const apps = s.players.filter(p => p.online);
  // nothing to choose from and nothing selected: stay out of the way
  if (s.backend === "reaper" && s.players.length === 0) return null;

  const others = s.controllers.length;
  const desktop = s.backend === "desktop";
  return (
    <div className="trk-link">
      <span className="trk-link-who">
        {desktop ? <MonitorSmartphone size={14} /> : <Server size={14} />}
        Bediening: <strong>{desktop ? (s.player?.name || "desktop-app") : "REAPER"}</strong>
        {desktop && s.player && <span className={`trk-link-dot${s.player.online ? " on" : ""}`} title={s.player.online ? "verbonden" : "niet verbonden"} />}
      </span>
      {others > 0 && (
        <span className="trk-meta" title={s.controllers.map(c => `${c.user} (${c.device})`).join(", ")}>
          <Users size={12} /> {others} {others === 1 ? "scherm" : "schermen"}{s.last ? ` · laatst: ${s.last.user} (${s.last.device})` : ""}
        </span>
      )}
      {desktop && s.player?.online && (
        <span className="trk-meta" title="Tijd tussen twee meldingen van de app (grootste in de laatste minuut) en hoe snel de app op het laatste commando reageerde">
          melding ≤{Math.round((s.player.maxGapMs || 0) / 100) / 10} s{s.last?.ms != null ? ` · reactie ${s.last.ms} ms` : ""}
        </span>
      )}
      {desktop && !s.player?.online && (
        <span className="trk-link-warn"><AlertTriangle size={13} /> App niet verbonden
          <button className="trk-load" onClick={() => switchTo("reaper")}>Schakel naar REAPER</button>
        </span>
      )}
      {desktop && s.player?.online && <button className="trk-icon-btn" onClick={() => switchTo("reaper")}>Naar REAPER</button>}
      {!desktop && apps.length === 0 && s.players.length > 0 && (
        <span className="trk-meta" title="De app meldt zich niet (meer): staat hij aan, is Afstandsbediening toestaan aangevinkt en is hij ingelogd?">
          {s.players.map(p => p.name).join(", ")}: niet verbonden
        </span>
      )}
      {!desktop && apps.map(p => (
        <button key={p.id} className="trk-icon-btn" onClick={() => switchTo("desktop", p.id)}>Naar {p.name}</button>
      ))}
    </div>
  );
}
