"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { QlcFixture } from "@/lib/qlcWorkspace";
import type { QlcFunction, SceneFn, ChaserFn, ChaserStep } from "@/lib/qlcFunctions";
import { useQlcFeed } from "@/lib/useQlcFeed";
import StageView, { fixtureLight } from "./StageView";
import TempoTap from "./TempoTap";

interface LibColor { id: string; name: string; hex: string }

// Make and change scenes and chases of the QLC+ workspace. A scene is the value of every channel of the fixtures it contains;
// a chase plays scenes one after another. Saving writes the workspace and has QLC+ load it again.

type Values = Record<number, number[]>;
type Editing =
  | { kind: "scene"; id?: number; name: string; path: string; values: Values; button: boolean }
  | { kind: "chase"; id?: number; name: string; path: string; button: boolean; tempo: boolean; steps: ChaserStep[]; direction: "Forward" | "Backward"; runOrder: ChaserFn["runOrder"] }
  | null;

const COLOR_NAMES: Record<string, string> = { FF0000: "Rood", "00FF00": "Groen", "0000FF": "Blauw", FFFFFF: "Wit", FF7E00: "Amber", "9400D3": "UV", "00FFFF": "Cyaan", FF00FF: "Magenta", FFFF00: "Geel" };
const GROUP_NAMES: Record<string, string> = { "1": "Kleur", "2": "Gobo", "3": "Snelheid", "4": "Pan", "5": "Tilt", "6": "Shutter/strobe", "7": "Prisma", "8": "Bundel", "9": "Effect", "10": "Onderhoud" };

function describe(type: string | undefined, k: number): { label: string; hex: string | null; master: boolean; intensity: boolean } {
  const m = /^(\d+)(?:\.#([0-9A-Fa-f]{6}))?$/.exec(type || "");
  if (!m) return { label: `Kanaal ${k + 1}`, hex: null, master: false, intensity: false };
  if (m[1] === "0") {
    const hex = (m[2] || "000000").toUpperCase();
    if (hex === "000000") return { label: "Dimmer", hex: null, master: true, intensity: true };
    return { label: COLOR_NAMES[hex] || `#${hex}`, hex, master: false, intensity: true };
  }
  return { label: GROUP_NAMES[m[1]] || `Kanaal ${k + 1}`, hex: null, master: false, intensity: false };
}

const toHex = (r: number, g: number, b: number) => "#" + [r, g, b].map(x => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, "0")).join("");

const secs = (ms: number) => String(Math.round(ms / 100) / 10);

export default function LightEditor() {
  const [fixtures, setFixtures] = useState<QlcFixture[]>([]);
  const [functions, setFunctions] = useState<QlcFunction[]>([]);
  const [editing, setEditing] = useState<Editing>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("");
  const [selection, setSelection] = useState<Set<number>>(new Set());
  const [openFx, setOpenFx] = useState<number | null>(null);
  const [previewStep, setPreviewStep] = useState<number>(0);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [palette, setPalette] = useState<LibColor[]>([]);
  const [manage, setManage] = useState(false);
  const [pick, setPick] = useState("#ff0000");
  const feed = useQlcFeed();

  const load = useCallback(async () => {
    const res = await fetch("/api/lights/functions", { cache: "no-store" });
    const j = await res.json();
    if (!res.ok || j.error) throw new Error(j.error || `HTTP ${res.status}`);
    setFixtures(j.fixtures); setFunctions(j.functions);
  }, []);
  useEffect(() => {
    fetch("/api/lights/colors", { cache: "no-store" }).then(r => r.json()).then(j => { if (Array.isArray(j.colors)) setPalette(j.colors); }).catch(() => { /* the library stays empty */ });
  }, []);
  useEffect(() => { load().catch(err => setMessage({ ok: false, text: err instanceof Error ? err.message : "Laden mislukt" })); }, [load]);

  const scenes = useMemo(() => functions.filter((f): f is SceneFn => f.type === "Scene"), [functions]);
  const chases = useMemo(() => functions.filter((f): f is ChaserFn => f.type === "Chaser"), [functions]);
  const sceneById = useMemo(() => new Map(scenes.map(s => [s.id, s])), [scenes]);
  const match = (n: string, p: string) => !filter || `${p} ${n}`.toLowerCase().includes(filter.toLowerCase());

  const types = feed.types.current;
  const dmxSize = useMemo(() => Math.max(16, ...fixtures.map(f => f.address + f.channels + 1)), [fixtures]);

  const blank = useCallback((): Values => Object.fromEntries(fixtures.map(f => [f.id, Array.from({ length: f.channels }, () => 0)])), [fixtures]);

  // What the 3D preview shows: the scene being edited, or the scene of the selected chase step
  const preview = useMemo(() => {
    let vals: Values | undefined;
    if (editing?.kind === "scene") vals = editing.values;
    else if (editing?.kind === "chase") vals = sceneById.get(editing.steps[previewStep]?.scene)?.values;
    if (!vals) return undefined;
    const dmx = new Array(dmxSize).fill(0);
    for (const f of fixtures) (vals[f.id] || []).forEach((v, k) => { dmx[f.address + k] = v; });
    return dmx;
  }, [editing, previewStep, sceneById, fixtures, dmxSize]);

  const newScene = () => { setEditing({ kind: "scene", name: "Nieuwe scène", path: "", values: blank(), button: true }); setDirty(true); setSelection(new Set()); };
  const newChase = () => { setEditing({ kind: "chase", name: "Nieuwe chase", path: "", button: true, tempo: false, steps: [], direction: "Forward", runOrder: "Loop" }); setDirty(true); setPreviewStep(0); };
  const openFunction = (f: QlcFunction) => {
    if (dirty && !confirm("Niet-opgeslagen wijzigingen weggooien?")) return;
    if (f.type === "Scene") {
      const sc = f as SceneFn;
      const values = blank();
      for (const [fid, arr] of Object.entries(sc.values)) values[Number(fid)] = arr.slice();
      for (const fx of fixtures) { const a = values[fx.id] || []; while (a.length < fx.channels) a.push(0); values[fx.id] = a; }
      setEditing({ kind: "scene", id: sc.id, name: sc.name, path: sc.path, values, button: !!sc.button }); setSelection(new Set());
    } else if (f.type === "Chaser") {
      const c = f as ChaserFn;
      setEditing({ kind: "chase", id: c.id, name: c.name, path: c.path, button: !!c.button, tempo: !!c.tempo, steps: c.steps.map(s => ({ ...s })), direction: c.direction, runOrder: c.runOrder }); setPreviewStep(0);
    } else return;
    setDirty(false); setMessage(null);
  };

  // ---- scene editing
  const setChannel = (fid: number, k: number, v: number) => {
    setEditing(e => {
      if (!e || e.kind !== "scene") return e;
      const arr = (e.values[fid] || []).slice(); arr[k] = Math.round(Math.max(0, Math.min(255, v)));
      return { ...e, values: { ...e.values, [fid]: arr } };
    });
    setDirty(true);
  };

  /** Give a fixture a colour: the red, green and blue channels follow it, a lone dimmer follows the brightness, a master dimmer goes full when there is light */
  const colourFixture = (fx: QlcFixture, rgb: [number, number, number]) => {
    const known = Array.from({ length: fx.channels }, (_, k) => describe(types[fx.address + k], k));
    if (!known.some(i => i.hex || i.master)) {
      setMessage({ ok: false, text: types.some(Boolean) ? `${fx.name} heeft geen kleur- of dimmerkanaal dat ik herken: stel de kanalen ("Kanalen") met de hand in.` : `De kanaalsoorten zijn nog niet bekend, dus kleuren kiezen werkt niet. ${feed.info || "QLC+ is niet bereikbaar."}` });
      return;
    }
    setEditing(e => {
      if (!e || e.kind !== "scene") return e;
      const arr = (e.values[fx.id] || Array.from({ length: fx.channels }, () => 0)).slice();
      const infos = known;
      const hasColour = infos.some(i => i.hex);
      const on = Math.max(...rgb) > 0;
      infos.forEach((info, k) => {
        if (info.hex === "FF0000") arr[k] = rgb[0];
        else if (info.hex === "00FF00") arr[k] = rgb[1];
        else if (info.hex === "0000FF") arr[k] = rgb[2];
        else if (info.master) arr[k] = hasColour ? (on ? 255 : 0) : Math.round(0.3 * rgb[0] + 0.59 * rgb[1] + 0.11 * rgb[2]);
      });
      return { ...e, values: { ...e.values, [fx.id]: arr } };
    });
    setDirty(true);
  };

  const rgbOf = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const colourSelection = (h: string) => fixtures.filter(f => selection.has(f.id)).forEach(f => colourFixture(f, rgbOf(h)));

  const savePalette = async (colors: LibColor[]) => {
    setPalette(colors);
    try {
      const res = await fetch("/api/lights/colors", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ colors }) });
      const j = await res.json();
      if (!res.ok || j.error) throw new Error(j.error || `HTTP ${res.status}`);
      setPalette(j.colors);
    } catch (err) { setMessage({ ok: false, text: `Kleurenbibliotheek opslaan mislukt: ${err instanceof Error ? err.message : "onbekende fout"}` }); }
  };
  const addColor = () => {
    const name = (prompt("Naam van de kleur?") || "").trim();
    if (!name) return;
    savePalette([...palette, { id: `c${Date.now().toString(36)}`, name, hex: pick }]);
  };
  const renameColor = (c: LibColor) => {
    const name = (prompt("Nieuwe naam?", c.name) || "").trim();
    if (name) savePalette(palette.map(x => (x.id === c.id ? { ...x, name } : x)));
  };

  const fixtureColour = (fx: QlcFixture, vals: Values) => {
    const dmx = new Array(dmxSize).fill(0);
    (vals[fx.id] || []).forEach((v, k) => { dmx[fx.address + k] = v; });
    return fixtureLight(fx, dmx, types);
  };

  const toggleSelect = (id: number) => setSelection(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const models = useMemo(() => [...new Set(fixtures.map(f => `${f.manufacturer} ${f.model}`))], [fixtures]);

  // ---- chase editing
  const patchChase = (patch: Partial<Extract<Editing, { kind: "chase" }>>) => { setEditing(e => (e && e.kind === "chase" ? { ...e, ...patch } : e)); setDirty(true); };
  const patchStep = (i: number, patch: Partial<ChaserStep>) => {
    setEditing(e => (e && e.kind === "chase" ? { ...e, steps: e.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) } : e));
    setDirty(true);
  };
  const moveStep = (i: number, d: number) => {
    setEditing(e => {
      if (!e || e.kind !== "chase" || i + d < 0 || i + d >= e.steps.length) return e;
      const steps = e.steps.slice(); [steps[i], steps[i + d]] = [steps[i + d], steps[i]];
      return { ...e, steps };
    });
    setDirty(true);
  };

  // ---- saving
  const post = async (body: object) => {
    setBusy(true); setMessage(null);
    try {
      const res = await fetch("/api/lights/functions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json();
      if (!res.ok || j.error) throw new Error(j.error || `HTTP ${res.status}`);
      if (j.functions) { setFunctions(j.functions); setFixtures(j.fixtures); }
      return j as { id?: number; reload?: { ok: boolean; message: string } };
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : "Mislukt" });
      return null;
    } finally { setBusy(false); }
  };

  const save = async () => {
    if (!editing) return;
    const body = editing.kind === "scene"
      ? { action: "save-scene", id: editing.id, name: editing.name, path: editing.path, values: editing.values, button: editing.button }
      : { action: "save-chaser", id: editing.id, name: editing.name, path: editing.path, button: editing.button, tempo: editing.tempo, steps: editing.steps, direction: editing.direction, runOrder: editing.runOrder };
    const j = await post(body);
    if (!j) return;
    setEditing({ ...editing, id: j.id });
    setDirty(false);
    setMessage({ ok: j.reload?.ok !== false, text: `Opgeslagen. ${j.reload?.message || ""}` });
  };

  const remove = async () => {
    if (!editing || editing.id === undefined) return;
    if (!confirm(`"${editing.name}" verwijderen? Er blijft een reservekopie van het werkbestand staan.`)) return;
    const j = await post({ action: "delete", id: editing.id });
    if (!j) return;
    setEditing(null); setDirty(false);
    setMessage({ ok: true, text: `Verwijderd. ${j.reload?.message || ""}` });
  };

  const tryOut = async (on: boolean) => {
    if (!editing || editing.id === undefined) return;
    if (dirty) { setMessage({ ok: false, text: "Sla eerst op om het op het podium uit te proberen." }); return; }
    const j = await post({ action: on ? "start" : "stop", id: editing.id });
    if (j) setMessage({ ok: true, text: on ? "Gestart in QLC+." : "Gestopt." });
  };

  const listItem = (f: QlcFunction, kind: string) => (
    <button key={f.id} className={`led-item${editing?.id === f.id && editing.kind === kind ? " on" : ""}`} onClick={() => openFunction(f)}>
      <span>{f.name}</span>{f.path && <em>{f.path}</em>}
    </button>
  );

  return (
    <div className="led">
      <aside className="led-list">
        <div className="led-actions">
          <button className="stg-btn" onClick={newScene} style={{ marginLeft: 0 }}>+ Scène</button>
          <button className="stg-btn" onClick={newChase} style={{ marginLeft: 0 }}>+ Chase</button>
        </div>
        <input className="led-search" placeholder="Zoeken…" value={filter} onChange={e => setFilter(e.target.value)} />
        <h4>Chases ({chases.length})</h4>
        {chases.filter(c => match(c.name, c.path)).map(c => listItem(c, "chase"))}
        <h4>Scènes ({scenes.length})</h4>
        {scenes.filter(c => match(c.name, c.path)).map(c => listItem(c, "scene"))}
      </aside>

      <section className="led-main">
        <TempoTap />
        {message && <div className={`stg-msg ${message.ok ? "ok" : "err"}`}>{message.text}</div>}
        {!types.some(Boolean) && <div className="stg-msg err">Kanaalsoorten onbekend: kleuren kiezen werkt pas als QLC+ bereikbaar is. {feed.info}</div>}
        {!editing && <p className="stg-meta">Kies links een scène of chase, of maak een nieuwe. Wat je maakt komt in het werkbestand van QLC+ te staan en QLC+ laadt het meteen opnieuw.</p>}
        {editing && (
          <>
            <div className="led-head">
              <input className="led-name" value={editing.name} onChange={e => { setEditing({ ...editing, name: e.target.value }); setDirty(true); }} aria-label="Naam" />
              <input className="led-path" value={editing.path} placeholder="Map (bijv. Sfeer)" onChange={e => { setEditing({ ...editing, path: e.target.value }); setDirty(true); }} aria-label="Map in QLC+" />
              <label className="led-btnopt" title="Zet een knop in de Virtual Console van QLC+ en in Lichtregie"><input type="checkbox" checked={editing.button} onChange={e => { setEditing({ ...editing, button: e.target.checked }); setDirty(true); }} /> Knop in Lichtregie</label>
              <button className="stg-btn" onClick={save} disabled={busy || !dirty}>{busy ? "Bezig…" : "Opslaan"}</button>
              {editing.id !== undefined && <button className="stg-btn" onClick={() => tryOut(true)} disabled={busy}>Op het podium proberen</button>}
              {editing.id !== undefined && <button className="stg-btn" onClick={() => tryOut(false)} disabled={busy}>Stop</button>}
              {editing.id !== undefined && <button className="stg-btn danger" onClick={remove} disabled={busy}>Verwijderen</button>}
            </div>

            <StageView compact override={preview} />

            {editing.kind === "scene" && (
              <div className="led-scene">
                <div className="led-select">
                  <strong>Kleur voor de selectie ({selection.size})</strong>
                  <input type="color" aria-label="Kleur" disabled={selection.size === 0}
                    value={pick} onChange={e => { setPick(e.target.value); colourSelection(e.target.value); }} />
                  <button className="stg-btn" style={{ marginLeft: 0 }} onClick={() => fixtures.filter(f => selection.has(f.id)).forEach(f => colourFixture(f, [0, 0, 0]))} disabled={selection.size === 0}>Uit</button>
                  <span className="led-palette" role="group" aria-label="Kleurenbibliotheek">
                    {palette.map(c => (
                      <span key={c.id} className="led-pal">
                        <button className="led-pal-sw" style={{ background: c.hex }} title={manage ? `${c.name} (klik om de naam te wijzigen)` : c.name} aria-label={c.name}
                          disabled={!manage && selection.size === 0} onClick={() => (manage ? renameColor(c) : (setPick(c.hex), colourSelection(c.hex)))} />
                        {manage && <button className="led-pal-x" aria-label={`${c.name} verwijderen`} onClick={() => savePalette(palette.filter(x => x.id !== c.id))}>✕</button>}
                      </span>
                    ))}
                    <button className="stg-btn" style={{ marginLeft: 0 }} onClick={addColor} title="Bewaar de gekozen kleur in de bibliotheek">+ Bewaar</button>
                    <button className={`stg-btn${manage ? " on" : ""}`} style={{ marginLeft: 0 }} onClick={() => setManage(m => !m)}>{manage ? "Klaar" : "Beheer"}</button>
                  </span>
                  <span className="led-groups">
                    <button className="stg-btn" style={{ marginLeft: 0 }} onClick={() => setSelection(new Set(fixtures.map(f => f.id)))}>Alle</button>
                    {models.map(m => <button key={m} className="stg-btn" style={{ marginLeft: 0 }} onClick={() => setSelection(new Set(fixtures.filter(f => `${f.manufacturer} ${f.model}` === m).map(f => f.id)))}>{m}</button>)}
                    <button className="stg-btn" style={{ marginLeft: 0 }} onClick={() => setSelection(new Set())}>Niets</button>
                  </span>
                </div>
                {fixtures.map(fx => {
                  const vals = editing.values;
                  const L = fixtureColour(fx, vals);
                  const infos = Array.from({ length: fx.channels }, (_, k) => describe(types[fx.address + k], k));
                  const max = Math.max(L.r, L.g, L.b, 1e-6);
                  const norm = L.level > 0 ? toHex((L.r / max) * 255, (L.g / max) * 255, (L.b / max) * 255) : "#ffffff";
                  const open = openFx === fx.id;
                  return (
                    <div key={fx.id} className={`led-fx${selection.has(fx.id) ? " sel" : ""}`}>
                      <label className="led-fxhead">
                        <input type="checkbox" checked={selection.has(fx.id)} onChange={() => toggleSelect(fx.id)} aria-label={`Selecteer ${fx.name}`} />
                        <span className="led-swatch" style={{ background: toHex(60 + 195 * L.r, 60 + 195 * L.g, 60 + 195 * L.b) }} />
                        <strong>{fx.name}</strong>
                      </label>
                      <input type="color" value={norm} aria-label={`Kleur van ${fx.name}`}
                        onChange={e => { const h = e.target.value; const base: [number, number, number] = [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; const b = Math.max(L.level, 0.5); colourFixture(fx, base.map(x => Math.round(x * b)) as [number, number, number]); }} />
                      <input type="range" min={0} max={255} value={Math.round(L.level * 255)} aria-label={`Helderheid van ${fx.name}`}
                        onChange={e => { const lvl = Number(e.target.value) / 255; const base = L.level > 0 ? [L.r / max, L.g / max, L.b / max] : [1, 1, 1]; colourFixture(fx, base.map(x => Math.round(x * lvl * 255)) as [number, number, number]); }} />
                      <button className="led-more" onClick={() => setOpenFx(open ? null : fx.id)} aria-expanded={open}>{open ? "Kanalen ▲" : "Kanalen ▼"}</button>
                      {open && (
                        <div className="led-channels">
                          {infos.map((info, k) => (
                            <label key={k} className="led-ch">
                              <span>{info.label}</span>
                              <input type="range" min={0} max={255} value={vals[fx.id]?.[k] ?? 0} onChange={e => setChannel(fx.id, k, Number(e.target.value))} />
                              <em>{vals[fx.id]?.[k] ?? 0}</em>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {editing.kind === "chase" && (
              <div className="led-chase">
                <div className="led-chase-opts">
                  <label>Volgorde
                    <select value={editing.runOrder} onChange={e => patchChase({ runOrder: e.target.value as ChaserFn["runOrder"] })}>
                      <option value="Loop">Herhalen</option><option value="SingleShot">Eén keer</option><option value="PingPong">Heen en weer</option><option value="Random">Willekeurig</option>
                    </select>
                  </label>
                  <label className="led-btnopt" title="Elke stap duurt één tel van het tempo dat je tikt; de wachttijd hieronder telt dan niet mee"><input type="checkbox" checked={editing.tempo} onChange={e => patchChase({ tempo: e.target.checked })} /> Volgt het tempo (tik tempo)</label>
                  <label>Richting
                    <select value={editing.direction} onChange={e => patchChase({ direction: e.target.value as "Forward" | "Backward" })}>
                      <option value="Forward">Vooruit</option><option value="Backward">Achteruit</option>
                    </select>
                  </label>
                </div>
                {editing.steps.length === 0 && <p className="stg-meta">Nog geen stappen. Voeg een scène toe.</p>}
                {editing.steps.map((st, i) => (
                  <div key={i} className={`led-step${previewStep === i ? " on" : ""}`} onClick={() => setPreviewStep(i)}>
                    <span className="led-num">{i + 1}</span>
                    <select value={st.scene} onChange={e => patchStep(i, { scene: Number(e.target.value) })} onClick={e => e.stopPropagation()}>
                      {scenes.filter(s => s.id !== editing.id).map(s => <option key={s.id} value={s.id}>{s.path ? `${s.path} / ` : ""}{s.name}</option>)}
                    </select>
                    <label>Infaden <input type="number" min={0} step={0.1} value={secs(st.fadeIn)} onChange={e => patchStep(i, { fadeIn: Math.round(Number(e.target.value) * 1000) })} onClick={e => e.stopPropagation()} />s</label>
                    <label>Wacht <input type="number" min={0} step={0.1} value={secs(st.hold)} onChange={e => patchStep(i, { hold: Math.round(Number(e.target.value) * 1000) })} onClick={e => e.stopPropagation()} />s</label>
                    <label>Uitfaden <input type="number" min={0} step={0.1} value={secs(st.fadeOut)} onChange={e => patchStep(i, { fadeOut: Math.round(Number(e.target.value) * 1000) })} onClick={e => e.stopPropagation()} />s</label>
                    <button className="led-more" onClick={e => { e.stopPropagation(); moveStep(i, -1); }} aria-label="Omhoog">↑</button>
                    <button className="led-more" onClick={e => { e.stopPropagation(); moveStep(i, 1); }} aria-label="Omlaag">↓</button>
                    <button className="led-more" onClick={e => { e.stopPropagation(); setEditing(ed => (ed && ed.kind === "chase" ? { ...ed, steps: ed.steps.filter((_, j) => j !== i) } : ed)); setDirty(true); }} aria-label="Stap verwijderen">✕</button>
                  </div>
                ))}
                <button className="stg-btn" style={{ marginLeft: 0, alignSelf: "flex-start" }} disabled={scenes.length === 0}
                  onClick={() => patchChase({ steps: [...editing.steps, { scene: (scenes.find(s => s.id !== editing.id) || scenes[0]).id, fadeIn: 500, hold: 1500, fadeOut: 500 }] })}>+ Stap</button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
