"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { homeHref } from "@/lib/desktopEngine";
import { ChevronLeft, AlertTriangle } from "lucide-react";
import PracticePlayer from "@/components/practice/PracticePlayer";

// Practice page for band members at home: the songs of the next service and
// the whole library, played in this browser with an own mix.
export default function PracticePage() {
  const [access, setAccess] = useState<"loading" | "login" | "denied" | "ok">("loading");
  const home = homeHref();   // the desktop app has no dashboard to go back to

  useEffect(() => {
    fetch("/api/settings", { cache: "no-store" })
      .then(async res => {
        if (res.status === 401) return setAccess("login");
        const data = await res.json();
        const perms: string[] = data.userPermissions || [];
        const allowed = data.userRole === "admin" || perms.includes("oefenen") || perms.includes("tracks");
        setAccess(allowed ? "ok" : "denied");
      })
      .catch(() => setAccess("login"));
  }, []);

  if (access !== "ok") {
    const messages = {
      loading: "Laden…",
      login: "Log eerst in op het dashboard.",
      denied: "Je hebt geen rechten om te oefenen. Vraag een beheerder om het recht 'Oefenen (band)'.",
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
    <div className="trk-stage-page">
      <header className="trk-stage-header">
        <Link href={home} className="trk-icon-btn" aria-label="Terug" suppressHydrationWarning><ChevronLeft size={18} /></Link>
        <h1 className="gradient-text">Oefenen</h1>
      </header>
      <PracticePlayer stage />
    </div>
  );
}
