"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { QlcFunction } from "@/lib/qlcFunctions";
import { useQlcFeed } from "@/lib/useQlcFeed";

// The buttons of the scenes and chases made in the editor: press to start, press again to stop; lit while it runs.
export default function CustomLights() {
  const [functions, setFunctions] = useState<QlcFunction[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const [wanted, setWanted] = useState<Record<number, boolean>>({});   // what was just pressed, until QLC+ confirms
  const feed = useQlcFeed();

  const load = useCallback(() => {
    fetch("/api/lights/functions", { cache: "no-store" })
      .then(r => r.json())
      .then(j => { if (j.error) throw new Error(j.error); setFunctions(j.functions); setError(""); })
      .catch(err => setError(err instanceof Error ? err.message : "Laden mislukt"));
  }, []);
  useEffect(() => { load(); window.addEventListener("focus", load); return () => window.removeEventListener("focus", load); }, [load]);
  useEffect(() => { setWanted({}); }, [feed.running]);

  const mine = functions.filter(f => f.button);
  const isOn = (id: number) => wanted[id] ?? !!feed.running[id];

  const press = async (f: QlcFunction) => {
    const on = !isOn(f.id);
    setWanted(w => ({ ...w, [f.id]: on })); setBusy(f.id);
    try {
      const res = await fetch("/api/lights/functions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: on ? "start" : "stop", id: f.id }) });
      const j = await res.json();
      if (!res.ok || j.error) throw new Error(j.error || `HTTP ${res.status}`);
      setError("");
    } catch (err) {
      setWanted(w => { const n = { ...w }; delete n[f.id]; return n; });
      setError(`${f.name}: ${err instanceof Error ? err.message : "mislukt"}`);
    } finally { setBusy(null); }
  };

  return (
    <section className="glass-card" style={{ padding: "14px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px" }}>
        <strong style={{ fontSize: "0.95rem" }}>Eigen scènes en chases</strong>
        <Link href="/lights/editor" style={{ marginLeft: "auto", fontSize: "0.8rem", color: "var(--muted)" }}>Maken en aanpassen</Link>
      </div>
      {error && <div className="stg-msg err" style={{ marginBottom: "8px" }}>{error}</div>}
      {mine.length === 0 && !error && <p className="stg-meta">Nog geen eigen knoppen. Maak een scène of chase in de editor en laat "Knop in Lichtregie" aanstaan.</p>}
      <div className="cl-grid">
        {mine.map(f => (
          <button key={f.id} className={`cl-btn${isOn(f.id) ? " on" : ""}${f.type === "Chaser" ? " chase" : ""}`} onClick={() => press(f)} disabled={busy === f.id} aria-pressed={isOn(f.id)}>
            <strong>{f.name}</strong>
            <em>{f.type === "Chaser" ? "chase" : "scène"}{f.path ? ` · ${f.path}` : ""}</em>
          </button>
        ))}
      </div>
    </section>
  );
}
