"use client";

import React, { useState } from "react";
import { Mic, Square, CloudUpload } from "lucide-react";
import type { ReaperState } from "@/lib/reaperControl";
import { reaperAction } from "./useReaper";

interface OpnameCardProps {
  state: ReaperState | null;
  onError: (message: string) => void;
  onStatus: (message: string) => void;
}

// Ongeveer 21 mono-sporen op 24 bit/48 kHz (zie het opnamesjabloon): ruim 3 MB per seconde
const GB_PER_UUR = 11;

function hms(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// Opname van de band en de sprekers op de track-computer (REAPER, nieuw project uit het
// opnamesjabloon). Start met een eigen naam, stop met een bevestiging.
export default function OpnameCard({ state, onError, onStatus }: OpnameCardProps) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const bridge = state?.bridge;
  if (!bridge) return null;
  const run = bridge.opname;
  const playing = (state?.playState ?? 0) !== 0 && !run;
  const geenSjabloon = bridge.opnameSjabloon === false;
  const vrij = bridge.diskFreeGB;
  const uren = vrij !== undefined ? vrij / GB_PER_UUR : undefined;

  const act = async (body: object, okText?: string) => {
    setBusy(true);
    try {
      await reaperAction(body);
      if (okText) onStatus(okText);
      return true;
    } catch (err) {
      onError(err instanceof Error ? err.message : "Actie mislukt");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const start = async () => {
    if (await act({ action: "opnameStart", name }, "Opname gestart")) setName("");
  };

  const stop = async () => {
    const duur = run ? hms(run.seconds) : "";
    if (!confirm(`De opname${run?.name ? ` "${run.name}"` : ""} stoppen? (${duur})`)) return;
    await act({ action: "opnameStop" }, "Opname gestopt en bewaard");
  };

  const copy = bridge.lastOpname?.copy;
  const gb = (b?: number) => (b ? (b / 1e9).toFixed(1) + " GB" : "");

  if (run) {
    return (
      <section className="glass-card trk-timing recording">
        <div className="trk-setlist-head">
          <h3 className="trk-title"><span className="trk-rec-dot" /> Opname {run.name ? `"${run.name}"` : ""} <span style={{ opacity: 0.7, fontWeight: 400 }}>{hms(run.seconds)}</span></h3>
          <button className="trk-load" onClick={stop} disabled={busy} style={{ background: "rgba(239,68,68,0.9)" }}>
            <Square size={14} /> Stop opname
          </button>
        </div>
        {!run.recording && (
          <p className="trk-empty" style={{ color: "#f87171" }}>
            REAPER neemt niet op. Controleer op de track-computer het audio-apparaat (X-USB, in én uit) en of de sporen aan een ingang hangen.
          </p>
        )}
        <p className="trk-arr-hint" style={{ marginBottom: 0 }}>
          Map op de track-computer: <code>{run.folder.replace(/^.*\/Tracks\//, "~/Tracks/")}</code>
          {vrij !== undefined && <> · vrij: {vrij} GB{uren !== undefined && uren < 3 ? ` (nog ongeveer ${uren.toFixed(1)} uur)` : ""}</>}
        </p>
      </section>
    );
  }

  return (
    <section className="glass-card trk-timing">
      <div className="trk-setlist-head" style={{ marginBottom: 0, gap: 8, flexWrap: "wrap" }}>
        <h3 className="trk-title"><Mic size={18} style={{ color: "#ef4444" }} /> Opname</h3>
        <input
          className="input-field"
          style={{ flex: "1 1 220px", minWidth: 160 }}
          placeholder="Naam (bijv. Dienst 25 oktober), mag leeg"
          value={name}
          maxLength={60}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !busy && !playing && !geenSjabloon) start(); }}
        />
        <button className="trk-save" onClick={start} disabled={busy || playing || geenSjabloon}
          title={playing ? "Stop eerst het afspelen" : geenSjabloon ? "Het opnamesjabloon ontbreekt op de track-computer" : "Band en sprekers opnemen"}>
          <span className="trk-rec-dot" /> Opname starten
        </button>
      </div>
      {geenSjabloon && (
        <p className="trk-empty" style={{ marginTop: 8 }}>
          Het opnamesjabloon ontbreekt op de track-computer: zet <code>Ark_opname_band.RPP</code> in <code>~/Tracks/_tools/</code>.
        </p>
      )}
      {playing && <p className="trk-empty" style={{ marginTop: 8 }}>Stop eerst het afspelen om een opname te starten.</p>}
      {bridge.lastOpname && (
        <p className="trk-arr-hint" style={{ marginTop: 8, marginBottom: 0 }}>
          Laatste opname: {bridge.lastOpname.name || "(zonder naam)"} · {hms(bridge.lastOpname.seconds)} · <code>{bridge.lastOpname.folder.replace(/^.*\/Tracks\//, "~/Tracks/")}</code>
          {vrij !== undefined && <> · vrij: {vrij} GB (± {Math.max(0, uren ?? 0).toFixed(1)} uur)</>}
        </p>
      )}
      {bridge.lastOpname && (
        <p className="trk-arr-hint" style={{ marginTop: 4, marginBottom: 0, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap",
          color: copy?.status === "fout" ? "#f87171" : copy?.status === "klaar" ? "#4ade80" : undefined }}>
          <CloudUpload size={14} />
          {!copy && "NAS-kopie: nog niet gestart"}
          {copy?.status === "bezig" && "Kopiëren naar de NAS... (mag even duren, de opname zelf staat veilig op de track-computer)"}
          {copy?.status === "klaar" && `Gekopieerd naar de NAS en gecontroleerd (${copy.files} bestanden, ${gb(copy.bytes)}). De opname blijft ook op de track-computer staan.`}
          {copy?.status === "fout" && `Kopie naar de NAS mislukt: ${copy.message ?? "onbekende fout"}`}
          {copy?.status === "niet-ingesteld" && `NAS-kopie niet ingesteld (${copy.message ?? "zie de handleiding"})`}
          {copy?.status !== "bezig" && (
            <button className="trk-load" style={{ padding: "2px 10px" }} disabled={busy}
              onClick={() => act({ action: "opnameCopy" }, "Kopiëren naar de NAS gestart")}>
              {copy?.status === "klaar" ? "Opnieuw kopiëren" : "Kopieer naar de NAS"}
            </button>
          )}
        </p>
      )}
    </section>
  );
}
