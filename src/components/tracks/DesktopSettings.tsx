"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Save, FolderOpen, ExternalLink, Server } from "lucide-react";
import { engineCall } from "@/lib/desktopEngine";

interface EngineSettings { device: string; songs_root: string; freeshow_host: string; freeshow_port: number; output_mode: string }
interface Device { name: string; outputs: number }

const MODES: [string, string][] = [
  ["auto", "Automatisch (8 kanalen als het apparaat genoeg uitgangen heeft)"],
  ["multi", "8 kanalen (X32: elke bus op een eigen uitgang)"],
  ["3ch", "3 kanalen (click + guide op 1, tracks stereo op 2 + 3)"],
  ["2ch", "2 kanalen (click + guide op 1, tracks op 2)"],
  ["stereo", "Stereo (alles op 1 + 2, om te testen)"],
];

// Settings of the desktop app itself (the engine in the app): where the sound goes, where the songs are
// and where FreeShow runs. Nothing here is fixed in the app; the server address is set via the app's menu.
export default function DesktopSettings({ onStatus, onError }: { onStatus: (m: string) => void; onError: (m: string) => void }) {
  const [form, setForm] = useState<EngineSettings | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, d] = await Promise.all([engineCall("/settings"), engineCall("/devices")]);
      setForm(s);
      setDevices(d.devices || []);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Instellingen laden mislukt");
    }
  }, [onError]);

  useEffect(() => { load(); }, [load]);

  if (!form) return <p className="trk-empty">Laden…</p>;
  const set = (patch: Partial<EngineSettings>) => setForm({ ...form, ...patch });

  const save = async () => {
    setSaving(true);
    try {
      const r = await engineCall("/configure", {
        device: form.device, output_mode: form.output_mode, songs_root: form.songs_root,
        freeshow_host: form.freeshow_host, freeshow_port: form.freeshow_host ? form.freeshow_port || 5506 : "",
      });
      if (r.error) throw new Error(r.error);
      onStatus("Instellingen opgeslagen.");
      await load();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Opslaan mislukt");
    } finally {
      setSaving(false);
    }
  };

  const chooseFolder = async () => {
    const r = await window.arkDesktop?.chooseFolder();
    if (r?.path) set({ songs_root: r.path });
  };

  return (
    <section className="glass-card trk-dset">
      <h3 className="trk-title">Instellingen van de desktop-app</h3>

      <label className="trk-label">Audioapparaat (waar het geluid heen gaat)</label>
      <select className="input-field" value={form.device} onChange={e => set({ device: e.target.value })}>
        <option value="">Standaard van het systeem</option>
        {devices.map(d => <option key={d.name} value={d.name}>{d.name} ({d.outputs} uitgangen)</option>)}
      </select>

      <label className="trk-label">Uitgangen</label>
      <select className="input-field" value={form.output_mode} onChange={e => set({ output_mode: e.target.value })}>
        {MODES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
      </select>

      <label className="trk-label">Map met nummers op deze computer</label>
      <div className="trk-dset-row">
        <input className="input-field" value={form.songs_root} placeholder="leeg = ~/Tracks/Songs" onChange={e => set({ songs_root: e.target.value })} />
        <button className="trk-icon-btn" onClick={chooseFolder}><FolderOpen size={14} /> Kies…</button>
      </div>

      <label className="trk-label">FreeShow voor de cues (adres en poort van de REST-listener)</label>
      <div className="trk-dset-row">
        <input className="input-field" value={form.freeshow_host} placeholder="leeg = zoals ingesteld in de webapp" onChange={e => set({ freeshow_host: e.target.value })} />
        <input className="input-field trk-dset-port" type="number" value={form.freeshow_host ? form.freeshow_port : ""} placeholder="5506" onChange={e => set({ freeshow_port: parseInt(e.target.value) || 5506 })} />
      </div>

      <div className="trk-arr-actions">
        <button className="trk-load" onClick={save} disabled={saving}><Save size={14} /> {saving ? "Bezig…" : "Opslaan"}</button>
      </div>

      <h3 className="trk-title" style={{ marginTop: 20 }}>Server</h3>
      <p className="trk-arr-hint">
        Deze app haalt de pagina&apos;s, de dienst-setlist en het koppelen van tekst en timing bij de webapp op: <strong>{window.arkDesktop?.server || "(geen server ingesteld)"}</strong>.
        Het adres staat nergens vast in de app.
      </p>
      <div className="trk-arr-actions" style={{ justifyContent: "flex-start" }}>
        <button className="trk-save" onClick={() => window.arkDesktop?.openSettings()}><Server size={14} /> Server wijzigen…</button>
        <button className="trk-save" onClick={() => window.arkDesktop && window.arkDesktop.server && window.arkDesktop.openExternal(window.arkDesktop.server)}>
          <ExternalLink size={14} /> Webapp met alle instellingen openen in je browser
        </button>
      </div>
    </section>
  );
}
