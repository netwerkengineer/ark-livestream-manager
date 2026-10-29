"use client";

import React from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import FixtureManager from "@/components/lights/FixtureManager";

export default function LightsFixturesPage() {
  return (
    <div className="dashboard-container" style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <header className="glass-card" style={{ display: "flex", alignItems: "center", gap: "16px", padding: "20px 24px", marginBottom: "20px", flexWrap: "wrap" }}>
        <Link href="/lights" className="btn-outline" style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 16px", borderRadius: "8px" }}>
          <ChevronLeft size={18} /><span>Lichtregie</span>
        </Link>
        <div style={{ borderLeft: "1px solid var(--card-border)", height: "24px" }} />
        <div>
          <h1 className="gradient-text" style={{ fontSize: "1.5rem", lineHeight: "1.2" }}>Lampen toevoegen en verwijderen</h1>
          <p style={{ fontSize: "0.85rem", color: "var(--muted)" }}>Kies een lamp uit de QLC+-bibliotheek, geef hem een DMX-adres, en zet hem daarna op het podium.</p>
        </div>
        <span style={{ marginLeft: "auto", display: "flex", gap: "10px" }}>
          <Link href="/lights/stage" className="btn-outline" style={{ padding: "8px 14px", borderRadius: "8px", fontSize: "0.85rem" }}>Podium 2D/3D</Link>
          <Link href="/lights/editor" className="btn-outline" style={{ padding: "8px 14px", borderRadius: "8px", fontSize: "0.85rem" }}>Scènes en chases maken</Link>
        </span>
      </header>
      <FixtureManager />
    </div>
  );
}
