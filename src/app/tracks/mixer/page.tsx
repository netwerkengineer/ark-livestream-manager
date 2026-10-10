"use client";

import React, { useState, useEffect, useCallback } from "react";
import { AlertTriangle } from "lucide-react";
import TracksControl from "@/components/TracksControl";
import BackendBar from "@/components/tracks/BackendBar";
import { installDesktopAdapter } from "@/lib/desktopEngine";

// Same as on /tracks: in the desktop app the screens talk to the app's player; this has to be in place before the screen starts.
if (typeof window !== "undefined") installDesktopAdapter();

// The faders, for a tablet that has the stage view (/tracks) as its app: the stage view has no faders on purpose; from there a
// button leads here, and the "Podium" button leads back. Everything on one screen like the stage view: transport and master on
// top, the groups' faders under it (tap "stems" under a group for its stems).
export default function TracksMixerPage() {
  const [status, setStatus] = useState<"loading" | "login" | "denied" | "off" | "ok">("loading");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [settings, setSettings] = useState<any>(null);
  const [toast, setToast] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const show = useCallback((type: "success" | "error", text: string) => { setToast({ type, text }); setTimeout(() => setToast(null), 3000); }, []);

  useEffect(() => {
    fetch("/api/settings", { cache: "no-store" })
      .then(async res => {
        if (res.status === 401) return setStatus("login");
        const data = await res.json();
        const perms: string[] = data.userPermissions || [];
        if (data.userRole !== "admin" && !perms.includes("tracks")) return setStatus("denied");
        // "Tracks (REAPER)" may be off (no track computer) while a desktop app is the player
        let desktopPlayer = false;
        if (!data.reaperEnabled) {
          try { const l = await (await fetch("/api/desktop-link", { cache: "no-store" })).json(); desktopPlayer = l.backend === "desktop" || (l.players || []).length > 0; } catch { /* none */ }
        }
        setSettings({ ...data, reaperEnabled: data.reaperEnabled || desktopPlayer });
        setStatus(data.reaperEnabled || desktopPlayer ? "ok" : "off");
      })
      .catch(() => setStatus("login"));
  }, []);

  if (status !== "ok") {
    const text = { loading: "Laden…", login: "Log eerst in op het dashboard.", denied: "Je hebt geen rechten voor Tracks.", off: "Tracks (REAPER) staat uit in de instellingen." }[status];
    return (
      <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: "20px", padding: "20px", textAlign: "center" }}>
        {status !== "loading" && <AlertTriangle size={40} color="#f87171" />}
        <p style={{ color: "var(--muted)", maxWidth: "420px" }}>{text}</p>
      </div>
    );
  }

  return (
    <div className="trk-stage-page">
      <header className="trk-stage-header">
        <h1 className="gradient-text">Mixer</h1>
        <BackendBar onError={t => show("error", t)} onStatus={t => show("success", t)} compact />
        <a href="/tracks" className="trk-icon-btn" title="Terug naar het Podium">Podium</a>
      </header>
      <TracksControl settings={settings} mixerOnly />
      {toast && <div className={`trk-toast ${toast.type}`}>{toast.text}</div>}
    </div>
  );
}
