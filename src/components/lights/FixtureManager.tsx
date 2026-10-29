"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { QlcFixture } from "@/lib/qlcWorkspace";

interface LibHit { m: string; d: string; t: string; modes: { n: string; channels: number }[] }
type Msg = { ok: boolean; text: string } | null;

// The lamps of the workspace: see them, add lamps from the QLC+ library, move them to another address, remove them.
export default function FixtureManager() {
  const [fixtures, setFixtures] = useState<QlcFixture[]>([]);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<LibHit[]>([]);
  const [pick, setPick] = useState<{ hit: LibHit; mode: string } | null>(null);
  const [form, setForm] = useState({ name: "", universe: 0, address: 1, count: 1 });
  const [editing, setEditing] = useState<{ id: number; name: string; universe: number; address: number } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/lights/fixtures", { cache: "no-store" });
    const j = await res.json();
    if (!res.ok || j.error) throw new Error(j.error || `HTTP ${res.status}`);
    setFixtures(j.fixtures);
  }, []);
  useEffect(() => { load().catch(err => setMsg({ ok: false, text: err instanceof Error ? err.message : "Laden mislukt" })); }, [load]);

  // search the library as you type
  useEffect(() => {
    if (query.trim().length < 2) { setHits([]); return; }
    const t = setTimeout(() => {
      fetch(`/api/lights/fixtures?q=${encodeURIComponent(query.trim())}`, { cache: "no-store" })
        .then(r => r.json()).then(j => setHits(j.library || [])).catch(() => setHits([]));
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  const channelsOf = pick ? pick.hit.modes.find(m => m.n === pick.mode)?.channels ?? 0 : 0;

  const choose = async (hit: LibHit) => {
    const mode = hit.modes[0]?.n || "";
    setPick({ hit, mode });
    setForm(f => ({ ...f, name: f.name || hit.d }));
    await suggestAddress(hit, mode, form.count, form.universe);
  };
  const suggestAddress = async (hit: LibHit, mode: string, count: number, universe: number) => {
    const ch = hit.modes.find(m => m.n === mode)?.channels || 1;
    try {
      const j = await (await fetch(`/api/lights/fixtures?free=${universe}&channels=${ch * count}`, { cache: "no-store" })).json();
      if (typeof j.address === "number") setForm(f => ({ ...f, address: j.address + 1 }));
    } catch { /* keep what is typed */ }
  };

  const overlapOf = useMemo(() => {
    const map = new Map<number, string[]>();
    for (const a of fixtures) for (const b of fixtures) {
      if (a.id < b.id && a.universe === b.universe && a.address < b.address + b.channels && b.address < a.address + a.channels) {
        map.set(a.id, [...(map.get(a.id) || []), b.name]); map.set(b.id, [...(map.get(b.id) || []), a.name]);
      }
    }
    return map;
  }, [fixtures]);

  const post = async (body: object) => {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/lights/fixtures", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json();
      if (!res.ok || j.error) throw new Error(j.error || `HTTP ${res.status}`);
      setFixtures(j.fixtures);
      return j as { reload?: { ok: boolean; message: string }; scenesChanged?: number; ids?: number[] };
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Mislukt" });
      return null;
    } finally { setBusy(false); }
  };

  const add = async () => {
    if (!pick) return;
    const j = await post({ action: "add", manufacturer: pick.hit.m, model: pick.hit.d, mode: pick.mode, name: form.name, universe: form.universe, address: form.address - 1, count: form.count });
    if (!j) return;
    setMsg({ ok: j.reload?.ok !== false, text: `${j.ids?.length || 1} lamp${(j.ids?.length || 1) > 1 ? "en" : ""} toegevoegd. ${j.reload?.message || ""} Zet ${(j.ids?.length || 1) > 1 ? "ze" : "hem"} op het podium bij "Podium 2D/3D".` });
    setPick(null); setQuery(""); setHits([]); setForm({ name: "", universe: 0, address: 1, count: 1 });
  };

  const save = async () => {
    if (!editing) return;
    const j = await post({ action: "update", id: editing.id, name: editing.name, universe: editing.universe, address: editing.address - 1 });
    if (!j) return;
    setEditing(null);
    setMsg({ ok: j.reload?.ok !== false, text: `Opgeslagen. ${j.reload?.message || ""}` });
  };

  const remove = async (f: QlcFixture) => {
    let note = "";
    try {
      const u = await (await fetch(`/api/lights/fixtures?usage=${f.id}`, { cache: "no-store" })).json();
      if (u.sliders?.length) { setMsg({ ok: false, text: `Kan "${f.name}" niet verwijderen: hij wordt bestuurd door de schuif ${u.sliders.map((s: string) => `"${s}"`).join(", ")} in de Virtual Console. Haal die schuif eerst weg in QLC+.` }); return; }
      if (u.scenes?.length) note = `\n\n${u.scenes.length} scène${u.scenes.length > 1 ? "s" : ""} gebruik${u.scenes.length > 1 ? "en" : "t"} deze lamp; de waarden voor deze lamp worden daaruit gehaald.`;
    } catch { /* the delete itself reports problems */ }
    if (!confirm(`"${f.name}" verwijderen uit het lichtplan?${note}\n\nEr blijft een reservekopie van het werkbestand staan.`)) return;
    const j = await post({ action: "delete", id: f.id });
    if (j) setMsg({ ok: j.reload?.ok !== false, text: `"${f.name}" verwijderd${j.scenesChanged ? ` (${j.scenesChanged} scènes aangepast)` : ""}. ${j.reload?.message || ""}` });
  };

  return (
    <div className="fxm">
      {msg && <div className={`stg-msg ${msg.ok ? "ok" : "err"}`}>{msg.text}</div>}

      <section className="glass-card fxm-add">
        <h3>Lamp toevoegen</h3>
        <input className="led-search" placeholder="Zoek in de QLC+-bibliotheek (bijv. chauvet slimpar)…" value={query} onChange={e => { setQuery(e.target.value); setPick(null); }} />
        {!pick && hits.length > 0 && (
          <div className="fxm-hits">
            {hits.map(h => (
              <button key={`${h.m}|${h.d}`} className="led-item" onClick={() => choose(h)}>
                <span>{h.m} {h.d}</span><em>{h.t} · {h.modes.map(m => `${m.n} (${m.channels})`).join(", ")}</em>
              </button>
            ))}
          </div>
        )}
        {!pick && query.trim().length >= 2 && hits.length === 0 && <p className="stg-meta">Niets gevonden in de bibliotheek.</p>}
        {pick && (
          <div className="fxm-form">
            <strong>{pick.hit.m} {pick.hit.d}</strong>
            <label className="stg-field"><span>Modus ({channelsOf} kanalen)</span>
              <select value={pick.mode} onChange={e => { setPick({ ...pick, mode: e.target.value }); suggestAddress(pick.hit, e.target.value, form.count, form.universe); }}>
                {pick.hit.modes.map(m => <option key={m.n} value={m.n}>{m.n} ({m.channels} kanalen)</option>)}
              </select>
            </label>
            <label className="stg-field"><span>Naam</span><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
            <label className="stg-field"><span>Aantal gelijke lampen</span>
              <input type="number" min={1} max={40} value={form.count} onChange={e => { const n = Math.max(1, Number(e.target.value) || 1); setForm({ ...form, count: n }); suggestAddress(pick.hit, pick.mode, n, form.universe); }} /></label>
            <label className="stg-field"><span>Beginkanaal (DMX)</span><input type="number" min={1} max={512} value={form.address} onChange={e => setForm({ ...form, address: Number(e.target.value) })} /></label>
            <label className="stg-field"><span>Universum</span><input type="number" min={1} max={4} value={form.universe + 1} onChange={e => setForm({ ...form, universe: Math.max(0, (Number(e.target.value) || 1) - 1) })} /></label>
            <p className="stg-meta">Kanaal {form.address}–{form.address + channelsOf * form.count - 1}. Bij meer dan één lamp krijgen ze achter elkaar een eigen adres, genummerd.</p>
            <div className="fxm-actions">
              <button className="stg-btn" style={{ marginLeft: 0 }} onClick={add} disabled={busy || !form.name.trim()}>{busy ? "Bezig…" : "Toevoegen"}</button>
              <button className="stg-btn" style={{ marginLeft: 0 }} onClick={() => setPick(null)} disabled={busy}>Andere lamp kiezen</button>
            </div>
          </div>
        )}
      </section>

      <section className="glass-card">
        <h3>Lampen in het lichtplan ({fixtures.length})</h3>
        <div className="fxm-list">
          {[...fixtures].sort((a, b) => a.universe - b.universe || a.address - b.address).map(f => {
            const clash = overlapOf.get(f.id);
            const isEdit = editing?.id === f.id;
            return (
              <div key={f.id} className={`fxm-row${clash ? " warn" : ""}`}>
                {isEdit && editing ? (
                  <>
                    <input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} aria-label="Naam" />
                    <input type="number" min={1} max={512} value={editing.address} onChange={e => setEditing({ ...editing, address: Number(e.target.value) })} aria-label="Beginkanaal" />
                    <input type="number" min={1} max={4} value={editing.universe + 1} onChange={e => setEditing({ ...editing, universe: Math.max(0, (Number(e.target.value) || 1) - 1) })} aria-label="Universum" />
                    <span className="fxm-btns">
                      <button className="stg-btn" style={{ marginLeft: 0 }} onClick={save} disabled={busy}>Opslaan</button>
                      <button className="stg-btn" style={{ marginLeft: 0 }} onClick={() => setEditing(null)} disabled={busy}>Annuleer</button>
                    </span>
                  </>
                ) : (
                  <>
                    <span><strong>{f.name}</strong><em>{f.manufacturer} {f.model} · {f.mode}</em></span>
                    <span>kanaal {f.address + 1}{f.channels > 1 ? `–${f.address + f.channels}` : ""}</span>
                    <span>universum {f.universe + 1}</span>
                    <span className="fxm-btns">
                      <button className="led-more" onClick={() => setEditing({ id: f.id, name: f.name, universe: f.universe, address: f.address + 1 })}>Wijzig</button>
                      <button className="led-more" onClick={() => remove(f)} disabled={busy}>Verwijder</button>
                    </span>
                  </>
                )}
                {clash && <span className="fxm-warn" title="Twee lampen delen kanalen">overlapt met {clash.join(", ")}</span>}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
