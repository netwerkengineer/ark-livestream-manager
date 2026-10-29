"use client";

import React from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import StageView from "@/components/lights/StageView";

export default function LightsStagePage() {
  return (
    <div className="dashboard-container" style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <header className="glass-card" style={{ display: "flex", alignItems: "center", gap: "16px", padding: "20px 24px", marginBottom: "20px" }}>
        <Link href="/lights" className="btn-outline" style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 16px", borderRadius: "8px" }}>
          <ChevronLeft size={18} /><span>Lichtregie</span>
        </Link>
        <div style={{ borderLeft: "1px solid var(--card-border)", height: "24px" }} />
        <div>
          <h1 className="gradient-text" style={{ fontSize: "1.5rem", lineHeight: "1.2" }}>Podium: 2D en 3D</h1>
          <p style={{ fontSize: "0.85rem", color: "var(--muted)" }}>De lampen zoals ze hangen, met het licht dat QLC+ nu stuurt. Sleep een lamp in het plan om hem te verplaatsen.</p>
        </div>
      </header>
      <StageView />
    </div>
  );
}
