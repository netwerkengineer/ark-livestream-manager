"use client";

import React from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import LightEditor from "@/components/lights/LightEditor";

export default function LightsEditorPage() {
  return (
    <div className="dashboard-container" style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <header className="glass-card" style={{ display: "flex", alignItems: "center", gap: "16px", padding: "20px 24px", marginBottom: "20px", flexWrap: "wrap" }}>
        <Link href="/lights" className="btn-outline" style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 16px", borderRadius: "8px" }}>
          <ChevronLeft size={18} /><span>Lichtregie</span>
        </Link>
        <div style={{ borderLeft: "1px solid var(--card-border)", height: "24px" }} />
        <div>
          <h1 className="gradient-text" style={{ fontSize: "1.5rem", lineHeight: "1.2" }}>Scènes en chases maken</h1>
          <p style={{ fontSize: "0.85rem", color: "var(--muted)" }}>Maak een scène met kleuren per lamp, of een chase van scènes. Je ziet het meteen in het 3D-podium; opslaan zet het in QLC+.</p>
        </div>
        <span style={{ marginLeft: "auto", display: "flex", gap: "10px" }}><Link href="/lights/fixtures" className="btn-outline" style={{ padding: "8px 14px", borderRadius: "8px", fontSize: "0.85rem" }}>Lampen beheren</Link><Link href="/lights/stage" className="btn-outline" style={{ padding: "8px 14px", borderRadius: "8px", fontSize: "0.85rem" }}>Podium 2D/3D</Link></span>
      </header>
      <LightEditor />
    </div>
  );
}
