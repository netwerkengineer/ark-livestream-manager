"use client";

import React, { useState, useEffect, useCallback, useSyncExternalStore } from "react";
import Link from "next/link";
import { homeHref, installDesktopAdapter } from "@/lib/desktopEngine";
import { ChevronLeft, AlertTriangle } from "lucide-react";
import { useReaperState } from "@/components/tracks/useReaper";
import TransportBar from "@/components/tracks/TransportBar";
import SetlistPanel from "@/components/tracks/SetlistPanel";
import SectionsPanel from "@/components/tracks/SectionsPanel";
import PadsPanel from "@/components/tracks/PadsPanel";
import BackendBar from "@/components/tracks/BackendBar";

// In the desktop app, and on a tablet or phone that uses the app's own local control (no server), this screen talks to the
// app's player instead of to REAPER; this has to be in place before the screen starts.
if (typeof window !== "undefined") installDesktopAdapter();

// Stage view for the worship leader / music director: pick a song from the
// service setlist and change the arrangement live. No faders here, so nothing
// on stage can change the mix by accident.
export default function TracksStagePage() {
  const [access, setAccess] = useState<"loading" | "login" | "denied" | "disabled" | "ok">("loading");
  const home = homeHref();   // the desktop app has no dashboard to go back to
  // installed on a tablet's home screen: the stage view is the whole app, a way back to the dashboard is only in the way there
  const lan = useSyncExternalStore(() => () => undefined, () => !!(window.arkDesktop as { lan?: boolean } | undefined)?.lan, () => false);   // local control of the app (tablet/phone)
  const standalone = useSyncExternalStore(
    () => () => undefined,
    // (also on a tablet that uses the app's local control: the app serves only this page, there is no dashboard to go back to)
    () => window.matchMedia?.("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true || !!(window.arkDesktop as { lan?: boolean } | undefined)?.lan,
    () => false,
  );
  const [toast, setToast] = useState<{ type: "success" | "error"; text: string } | null>(null);
  // On a phone not everything fits on one screen: tabs pick sections, setlist or pads (the transport stays on top). A wider screen shows all.
  const [panel, setPanel] = useState<"sections" | "setlist" | "pads">("sections");
  const { state, error } = useReaperState(access === "ok");

  useEffect(() => {
    fetch("/api/settings", { cache: "no-store" })
      .then(async res => {
        if (res.status === 401) return setAccess("login");
        const data = await res.json();
        const perms: string[] = data.userPermissions || [];
        if (data.userRole !== "admin" && !perms.includes("tracks")) return setAccess("denied");
        // REAPER may be off in the settings (no track computer) while a desktop app is the player
        let desktopPlayer = false;
        if (!data.reaperEnabled) {
          try { const l = await (await fetch("/api/desktop-link", { cache: "no-store" })).json(); desktopPlayer = l.backend === "desktop" || (l.players || []).length > 0; } catch { /* none */ }
        }
        setAccess(data.reaperEnabled || desktopPlayer ? "ok" : "disabled");
      })
      .catch(() => setAccess("login"));
  }, []);

  // Keep a stage tablet from dimming/locking mid-song
  useEffect(() => {
    if (access !== "ok" || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    const request = () => navigator.wakeLock.request("screen").then(l => { lock = l; }).catch(() => undefined);
    request();
    const onVisible = () => { if (document.visibilityState === "visible") request(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      lock?.release().catch(() => undefined);
    };
  }, [access]);

  const show = useCallback((type: "success" | "error", text: string) => {
    setToast({ type, text });
    setTimeout(() => setToast(null), 3000);
  }, []);
  const showError = useCallback((text: string) => show("error", text), [show]);
  const showSuccess = useCallback((text: string) => show("success", text), [show]);

  if (access !== "ok") {
    const messages = {
      loading: "Laden…",
      login: "Log eerst in op het dashboard.",
      denied: "Je hebt geen rechten voor Tracks. Vraag een beheerder om het recht 'Tracks (REAPER)'.",
      disabled: "Tracks (REAPER) staat uit in de instellingen.",
    };
    return (
      <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: "20px", padding: "20px", textAlign: "center" }}>
        {access !== "loading" && <AlertTriangle size={40} color="#f87171" />}
        <p style={{ color: "var(--muted)", maxWidth: "420px" }}>{messages[access]}</p>
        {access !== "loading" && <Link href={home} className="btn-primary" suppressHydrationWarning>Terug</Link>}
      </div>
    );
  }

  return (
    <div className="trk-stage-page" data-panel={panel}>
      <header className="trk-stage-header">
        {!standalone && <Link href={home} className="trk-icon-btn" aria-label="Terug" suppressHydrationWarning><ChevronLeft size={18} /></Link>}
        <h1 className="gradient-text">Podium</h1>
        <BackendBar onError={showError} onStatus={showSuccess} compact />
        {/* the stage view has no faders on purpose; this leads to the mixer page (the app's own web server has it too) */}
        <a href="/tracks/mixer" className="trk-icon-btn" title="De faders">Mixer</a>
        <span className={`trk-conn${error ? " off" : ""}`}>{error ? "Niet verbonden" : "Verbonden"}</span>
      </header>

      <TransportBar state={state} onError={showError} stage />
      <div className="trk-phone-tabs" role="tablist" aria-label="Onderdeel">
        {([["sections", "Secties"], ["setlist", "Setlist"], ["pads", "Pads"]] as const).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={panel === id} className={`trk-phone-tab${panel === id ? " on" : ""}`} onClick={() => setPanel(id)}>{label}</button>
        ))}
      </div>
      <div className="trk-stage-grid">
        <SectionsPanel state={state} onError={showError} stage />
        <SetlistPanel state={state} onError={showError} onStatus={showSuccess} stage />
      </div>
      <PadsPanel state={state} onError={showError} stage />

      {toast && <div className={`trk-toast ${toast.type}`}>{toast.text}</div>}
    </div>
  );
}
