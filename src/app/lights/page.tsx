"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useSession, signIn } from "next-auth/react";
import { ChevronLeft } from "lucide-react";
import LightsControl from "@/components/LightsControl";

// The Lichtregie page is the same control panel as the Licht tab of the dashboard (LightsControl), just on a page of its own.
export default function LightsPage() {
  const { data: session, status: sessionStatus } = useSession();
  const [settings, setSettings] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/settings")
      .then((res) => res.json())
      .then((data) => { if (!data.error) setSettings(data); })
      .catch((err) => console.error("Error fetching settings:", err))
      .finally(() => setLoading(false));
  }, []);

  if (sessionStatus === "loading" || loading) {
    return (
      <div className="flex-center" style={{ height: "100vh", flexDirection: "column", gap: "20px" }}>
        <div className="spinner"></div>
        <p style={{ color: "var(--muted)" }}>Lichtregie laden...</p>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex-center" style={{ height: "100vh", flexDirection: "column", gap: "32px", maxWidth: "400px", margin: "0 auto", padding: "20px" }}>
        <div style={{ textAlign: "center" }}>
          <h2 style={{ fontSize: "2rem", marginBottom: "8px" }}>Toegang Geweigerd</h2>
          <p style={{ color: "var(--muted)" }}>Je moet ingelogd zijn om de lichtregie te openen.</p>
        </div>
        <button className="btn-primary" style={{ width: "100%" }} onClick={() => signIn("google")}>
          Verbind met Google
        </button>
      </div>
    );
  }

  return (
    <div className="dashboard-container" style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <header className="glass-card" style={{ display: "flex", alignItems: "center", gap: "16px", padding: "24px", marginBottom: "32px" }}>
        <Link href="/" className="btn-outline" style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 16px", borderRadius: "8px" }}>
          <ChevronLeft size={18} />
          <span>Dashboard</span>
        </Link>
        <div style={{ borderLeft: "1px solid var(--card-border)", height: "24px" }} />
        <h1 className="gradient-text" style={{ fontSize: "1.6rem", lineHeight: "1.2" }}>Lichtregie</h1>
      </header>
      <LightsControl settings={settings} />
    </div>
  );
}
