"use client";

import React, { useState, useEffect } from "react";
import { AlertTriangle, SlidersHorizontal, Headphones } from "lucide-react";
import TracksControl from "@/components/TracksControl";
import PracticePlayer from "@/components/practice/PracticePlayer";
import { hasDesktopEngine, installDesktopAdapter, engineCall, isOffline } from "@/lib/desktopEngine";

// In the desktop app the Tracks screens talk to the engine in the app instead of to REAPER;
// this has to be in place before the screens start.
if (typeof window !== "undefined") installDesktopAdapter();

// The engine uses the FreeShow address of the web app's settings, unless an own address is set in the app's settings
async function syncEngine(data: { freeShowHost?: string; freeShowPort?: number; reaperCueLeadBeats?: number }) {
  try {
    const es = await engineCall("/state");
    if (!es.freeshow_override) {
      await engineCall("/freeshow", { runtime: 1, host: data.freeShowHost || "", port: (data.freeShowPort || 5505) + 1 });   // FreeShow's REST API is one port above its WebSocket API
    }
    if (typeof data.reaperCueLeadBeats === "number" && data.reaperCueLeadBeats !== es.lead_beats) await engineCall("/lead", { beats: data.reaperCueLeadBeats });
  } catch { /* the screens show the engine error themselves */ }
}

type Tab = "tracks" | "oefenen";

// Shell for the desktop app (a window that only shows this page): the full Tracks control and
// the practice player of the web app, without the rest of the dashboard.
// Also works in any browser at /desktop.
export default function DesktopPage() {
  const [status, setStatus] = useState<"loading" | "login" | "ok">("loading");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [settings, setSettings] = useState<any>(null);
  const [tab, setTab] = useState<Tab | null>(null);
  const [allowed, setAllowed] = useState<Tab[]>([]);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    fetch("/api/settings", { cache: "no-store" })
      .then(async res => {
        if (res.status === 401) return setStatus("login");
        const data = await res.json();
        const perms: string[] = data.userPermissions || [];
        const admin = data.userRole === "admin";
        const tabs: Tab[] = [];
        if (admin || perms.includes("tracks")) tabs.push("tracks");      // Tracks (REAPER) in the settings is about the track computer: the app plays on its own
        if (!isOffline() && (admin || perms.includes("oefenen") || perms.includes("tracks"))) tabs.push("oefenen");   // practice stems come from the server
        setSettings(data);
        setOffline(isOffline());
        setAllowed(tabs);
        if (hasDesktopEngine() && !isOffline()) syncEngine(data);
        const saved = (() => { try { return localStorage.getItem("ark-desktop-tab"); } catch { return null; } })();
        setTab(tabs.includes(saved as Tab) ? (saved as Tab) : tabs[0] ?? null);
        setStatus("ok");
      })
      .catch(() => setStatus("login"));
  }, []);

  const choose = (t: Tab) => {
    setTab(t);
    try { localStorage.setItem("ark-desktop-tab", t); } catch { /* private window: no memory */ }
  };

  if (status !== "ok" || !tab) {
    const text = status === "loading" ? "Laden…"
      : status === "login" ? "Log in om Tracks en Oefenen te gebruiken."
      : "Je hebt geen rechten voor Tracks of Oefenen. Vraag een beheerder om het recht 'Tracks (REAPER)' of 'Oefenen (band)'.";
    return (
      <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: "20px", padding: "20px", textAlign: "center" }}>
        {status !== "loading" && <AlertTriangle size={40} color="#f87171" />}
        <p style={{ color: "var(--muted)", maxWidth: "420px" }}>{status === "ok" ? "Je hebt geen rechten voor Tracks of Oefenen. Vraag een beheerder om het recht 'Tracks (REAPER)' of 'Oefenen (band)'." : text}</p>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        {status === "login" && <a href="/api/auth/signin" className="btn-primary">Inloggen</a>}
      </div>
    );
  }

  return (
    <div style={{ padding: "12px 16px", maxWidth: "1400px", margin: "0 auto" }}>
      <nav style={{ display: "flex", gap: "8px", marginBottom: "14px" }}>
        {allowed.includes("tracks") && (
          <button className={`trk-icon-btn${tab === "tracks" ? " pinned" : ""}`} onClick={() => choose("tracks")}><SlidersHorizontal size={14} /> Tracks</button>
        )}
        {offline && <span className="trk-meta" style={{ alignSelf: "center", marginLeft: "auto" }} title="Alleen spelen: setlist, mixer en cues werken lokaal. Bewerken en ophalen kan weer met de server.">Zonder server</span>}
        {allowed.includes("oefenen") && (
          <button className={`trk-icon-btn${tab === "oefenen" ? " pinned" : ""}`} onClick={() => choose("oefenen")}><Headphones size={14} /> Oefenen</button>
        )}
      </nav>
      {tab === "tracks" ? <TracksControl settings={{ ...settings, reaperEnabled: true }} /> : <PracticePlayer />}
    </div>
  );
}
