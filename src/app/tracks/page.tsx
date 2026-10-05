"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { ChevronLeft, AlertTriangle } from "lucide-react";
import { useReaperState } from "@/components/tracks/useReaper";
import TransportBar from "@/components/tracks/TransportBar";
import SetlistPanel from "@/components/tracks/SetlistPanel";
import SectionsPanel from "@/components/tracks/SectionsPanel";
import PadsPanel from "@/components/tracks/PadsPanel";

// Stage view for the worship leader / music director: pick a song from the
// service setlist and change the arrangement live. No faders here, so nothing
// on stage can change the mix by accident.
export default function TracksStagePage() {
  const [access, setAccess] = useState<"loading" | "login" | "denied" | "disabled" | "ok">("loading");
  const [toast, setToast] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const { state, error } = useReaperState(access === "ok");

  useEffect(() => {
    fetch("/api/settings", { cache: "no-store" })
      .then(async res => {
        if (res.status === 401) return setAccess("login");
        const data = await res.json();
        const perms: string[] = data.userPermissions || [];
        if (data.userRole !== "admin" && !perms.includes("tracks")) return setAccess("denied");
        setAccess(data.reaperEnabled ? "ok" : "disabled");
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
        {access !== "loading" && <Link href="/" className="btn-primary">Naar het dashboard</Link>}
      </div>
    );
  }

  return (
    <div className="trk-stage-page">
      <header className="trk-stage-header">
        <Link href="/" className="trk-icon-btn" aria-label="Dashboard"><ChevronLeft size={18} /></Link>
        <h1 className="gradient-text">Podium</h1>
        <span className={`trk-conn${error ? " off" : ""}`}>{error ? "REAPER niet bereikbaar" : "Verbonden"}</span>
      </header>

      <TransportBar state={state} onError={showError} stage />
      <div className="trk-stage-grid">
        <SectionsPanel state={state} onError={showError} stage />
        <SetlistPanel state={state} onError={showError} onStatus={showSuccess} stage />
      </div>
      <PadsPanel state={state} onError={showError} stage />

      {toast && <div className={`trk-toast ${toast.type}`}>{toast.text}</div>}
    </div>
  );
}
