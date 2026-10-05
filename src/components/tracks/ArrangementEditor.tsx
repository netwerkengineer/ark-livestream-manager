"use client";

import React, { useState, useEffect, useCallback } from "react";
import { X, Wand2, Save, Search, AlertTriangle, Music2 } from "lucide-react";
import { sectionColor } from "./songName";

interface Section { id: number; name: string; start: number; finish?: number }
interface Group { id: string; group: string; text: string; slides: number }
interface ArrangementData {
  sections: Section[];
  instrumental: string[];
  showFile: string | null;
  showName: string | null;
  groups: Group[];
  mapping: Record<string, string[]>;
  suggestion: Record<string, string[]>;
  saved: { at: string; by: string } | null;
}

interface ArrangementEditorProps {
  song: { title: string; artist: string; path: string };
  onClose: () => void;
  onError: (message: string) => void;
  onStatus: (message: string) => void;
}

const firstLine = (text: string) => text.split("\n")[0] || "(leeg)";

// Links the lyric groups of the song's FreeShow show to the sections of its
// track. Saving writes the "Tracks" layout into the show and gives the cue
// table to the bridge in REAPER.
export default function ArrangementEditor({ song, onClose, onError, onStatus }: ArrangementEditorProps) {
  const [data, setData] = useState<ArrangementData | null>(null);
  const [mapping, setMapping] = useState<Record<string, string[]>>({});
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<{ file: string; name: string }[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  // Sections shown per occurrence ("1e keer", "2e keer", ...)
  const [perTime, setPerTime] = useState<Set<string>>(new Set());

  const load = useCallback(async (show?: string) => {
    try {
      const q = new URLSearchParams({ path: song.path, title: song.title, artist: song.artist });
      if (show) q.set("show", show);
      const res = await fetch(`/api/reaper/arrangement?${q}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error || `HTTP ${res.status}`);
      setData(json);
      setMapping(json.mapping);
      setPerTime(new Set(Object.keys(json.mapping).filter(k => k.includes("#")).map(k => k.slice(0, k.lastIndexOf("#")))));
      setResults(null);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Laden mislukt");
    }
  }, [song.path, song.title, song.artist, onError]);

  useEffect(() => { load(); }, [load]);

  const findShows = async () => {
    try {
      const res = await fetch(`/api/reaper/arrangement?search=${encodeURIComponent(search)}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error || `HTTP ${res.status}`);
      setResults(json.shows);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Zoeken mislukt");
    }
  };

  const save = async () => {
    if (!data?.showFile) return;
    setSaving(true);
    try {
      const res = await fetch("/api/reaper/arrangement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: song.path, showFile: data.showFile, mapping }),
      });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error || `HTTP ${res.status}`);
      setWarnings(json.warnings || []);
      onStatus(`Tracks-layout (${json.slides} dia's) staat in "${data.showName}". Na een FreeShow-sync volgt FreeShow de track.`);
      if (!json.warnings?.length) onClose();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Opslaan mislukt");
    } finally {
      setSaving(false);
    }
  };

  const names = data ? [...new Set(data.sections.map(s => s.name))] : [];
  const count = (name: string) => data?.sections.filter(s => s.name === name).length || 0;
  const groupById = (id: string) => data?.groups.find(g => g.id === id);
  const keyFor = (name: string, n: number) => `${name}#${n}`;
  const idsFor = (name: string, n: number) => mapping[keyFor(name, n)] ?? mapping[name] ?? [];
  const seenCount: Record<string, number> = {};
  const totalSlides = data ? data.sections.reduce((sum, s, i) => {
    const n = (seenCount[s.name] = (seenCount[s.name] || 0) + 1);
    const ids = idsFor(s.name, n).filter(id => groupById(id));
    if (i === 0 && data.instrumental.includes(s.name)) return sum + 1;
    return sum + (ids.length ? ids.reduce((n, id) => n + (groupById(id)?.slides || 1), 0) : 1);
  }, 0) : 0;

  // Switch a section between one set of lyrics for every time and one per time
  const togglePerTime = (name: string) => {
    const next = new Set(perTime);
    const m = { ...mapping };
    if (next.has(name)) {
      next.delete(name);
      for (const k of Object.keys(m)) if (k.startsWith(`${name}#`)) delete m[k];
    } else {
      next.add(name);
      for (let n = 1; n <= count(name); n++) m[keyFor(name, n)] = [...(m[name] || [])];
    }
    setPerTime(next);
    setMapping(m);
  };

  const renderGroups = (key: string, ids: string[], instrumental: boolean) => (
    <div className="trk-arr-groups">
      {ids.map((id, i) => {
        const g = groupById(id);
        return (
          <span key={`${id}-${i}`} className="trk-chip" title={g?.text}>
            <b>{g?.group || "?"}</b> {g ? firstLine(g.text) : "(verwijderd)"} {g && g.slides > 1 && <i>· {g.slides} dia&apos;s</i>}
            <button onClick={() => setMapping({ ...mapping, [key]: ids.filter((_, j) => j !== i) })} aria-label="Weghalen">×</button>
          </span>
        );
      })}
      {ids.length === 0 && <span className="trk-chip empty">{instrumental ? "lege dia" : "geen tekst"}</span>}
      <select className="input-field trk-arr-add" value="" onChange={e => {
        if (e.target.value) setMapping({ ...mapping, [key]: [...ids, e.target.value] });
      }}>
        <option value="">+ tekst</option>
        {data?.groups.map(g => (
          <option key={g.id} value={g.id}>[{g.group}] {firstLine(g.text)}</option>
        ))}
      </select>
    </div>
  );

  return (
    <div className="trk-modal-backdrop" onClick={onClose}>
      <div className="glass-card trk-modal" onClick={e => e.stopPropagation()}>
        <div className="trk-setlist-head">
          <h3 className="trk-title"><Music2 size={18} style={{ color: "#06b6d4" }} /> Tekst ↔ secties – {song.title}</h3>
          <button className="trk-icon-btn" onClick={onClose} aria-label="Sluiten"><X size={16} /></button>
        </div>

        {!data ? <p className="trk-empty">Laden…</p> : (
          <>
            <div className="trk-arr-show">
              <span className="trk-label">FreeShow-show</span>
              <strong>{data.showName || "Geen show gevonden voor dit lied"}</strong>
              <div className="trk-arr-search">
                <input className="input-field" placeholder="Andere show zoeken…" value={search}
                  onChange={e => setSearch(e.target.value)} onKeyDown={e => { if (e.key === "Enter") findShows(); }} />
                <button className="trk-icon-btn" onClick={findShows} title="Zoeken"><Search size={14} /></button>
              </div>
              {results && (
                <ul className="trk-arr-results">
                  {results.length === 0 && <li className="trk-empty">Niets gevonden in de categorie liederen.</li>}
                  {results.map(r => (
                    <li key={r.file}><button onClick={() => load(r.file)}>{r.name}</button></li>
                  ))}
                </ul>
              )}
            </div>

            {data.showFile && (
              <>
                <p className="trk-arr-hint">
                  Per sectie van de track de tekst die erbij hoort. Instrumentale delen blijven leeg (lege dia).
                  Een sectie die vaker voorkomt, gebruikt telkens dezelfde dia&apos;s, tenzij je &quot;Per keer&quot; kiest
                  (bijvoorbeeld als het eerste refrein anders gezongen wordt dan de rest).
                  {data.saved && <> Laatst opgeslagen door {data.saved.by}.</>}
                  {" "}Opslaan zet de dia-blokken in REAPER opnieuw neer; handmatig verschoven blokken van dit nummer gaan dan verloren.
                </p>
                <div className="trk-arr-table">
                  {names.map(name => {
                    const instrumental = data.instrumental.includes(name);
                    const times = count(name);
                    const split = perTime.has(name);
                    return (
                      <div key={name} className="trk-arr-row" style={{ "--sec": sectionColor(name) } as React.CSSProperties}>
                        <div className="trk-arr-section">
                          <strong>{name}</strong>
                          <small>{times}× {instrumental && "· instrumentaal"}</small>
                          {times > 1 && (
                            <button className={`trk-arr-split${split ? " on" : ""}`} onClick={() => togglePerTime(name)}
                              title={split ? "Weer één tekst voor elke keer" : "Elke keer een eigen tekst kiezen"}>
                              {split ? "Eén voor alle" : "Per keer"}
                            </button>
                          )}
                        </div>
                        {split ? (
                          <div className="trk-arr-times">
                            {Array.from({ length: times }, (_, i) => i + 1).map(n => (
                              <div key={n} className="trk-arr-time">
                                <span className="trk-label">{n}e keer</span>
                                {renderGroups(keyFor(name, n), idsFor(name, n), instrumental)}
                              </div>
                            ))}
                          </div>
                        ) : renderGroups(name, mapping[name] || [], instrumental)}
                      </div>
                    );
                  })}
                </div>

                {warnings.map(w => <p key={w} className="trk-warn"><AlertTriangle size={14} /> {w}</p>)}

                <div className="trk-arr-actions">
                  <span className="trk-meta">{totalSlides} dia&apos;s in de Tracks-layout{totalSlides > 127 && " – meer dan 127, MIDI kan niet alles kiezen"}</span>
                  <button className="trk-save" onClick={() => {
                    setMapping(data.suggestion);
                    setPerTime(new Set(Object.keys(data.suggestion).filter(k => k.includes("#")).map(k => k.slice(0, k.lastIndexOf("#")))));
                  }}><Wand2 size={14} /> Voorstel</button>
                  <button className="trk-load" onClick={save} disabled={saving}><Save size={14} /> {saving ? "Bezig…" : "Opslaan in FreeShow"}</button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
