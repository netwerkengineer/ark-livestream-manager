"use client";

import React, { useState, useMemo, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { Music2, ChevronLeft, ChevronRight, Plus, Trash2, UploadCloud, Loader2, AlertTriangle, CheckCircle2, X } from "lucide-react";
import {
  OWN_KEYS, OWN_SIGS, AUDIO_EXTENSIONS, MAX_OWN_STEMS, validateOwnSong, sectionTimes, groupFor,
  type OwnSong,
} from "@/lib/ownSong";
import { formatTime } from "./useReaper";

interface Props {
  onClose: () => void;
  onDone: (title: string) => void;
  onError: (message: string) => void;
}

interface SectionRow { id: number; name: string; bar: string }
interface StemRow { id: number; file: File; name: string; duration: number | null }
interface Change { id: number; bar: string; value: string }

const PRESETS = ["Count Off", "Intro", "Verse", "Pre-Chorus", "Chorus", "Bridge", "Tag", "Instrumental", "Interlude", "Ending"];
const NUMBERED = ["Verse", "Pre-Chorus"];
const STEPS = ["Het nummer", "Secties", "Stems", "Uploaden"];
const MIN_CHUNK = 512 * 1024;

let nextId = 1;
const uid = () => nextId++;

const mb = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
const stemNameFromFile = (file: string) => file.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").trim();

// Length of an audio file. WAV: read from the header (no decoding, the app's
// content security policy doesn't allow audio elements on blob URLs); other
// formats are decoded, one at a time so a phone never holds several.
async function wavDuration(file: File): Promise<number | null> {
  const head = new DataView(await file.slice(0, 1024 * 1024).arrayBuffer());
  const tag = (o: number) => String.fromCharCode(head.getUint8(o), head.getUint8(o + 1), head.getUint8(o + 2), head.getUint8(o + 3));
  if (head.byteLength < 12 || (tag(0) !== "RIFF" && tag(0) !== "RF64") || tag(8) !== "WAVE") return null;
  let byteRate = 0;
  for (let o = 12; o + 8 <= head.byteLength;) {
    const size = head.getUint32(o + 4, true);
    if (tag(o) === "fmt " && o + 20 <= head.byteLength) byteRate = head.getUint32(o + 16, true);
    if (tag(o) === "data") {
      const bytes = size === 0xffffffff || o + 8 + size > file.size ? file.size - (o + 8) : size;
      return byteRate ? bytes / byteRate : null;
    }
    o += 8 + size + (size % 2);
  }
  return null;
}

let decodeQueue: Promise<unknown> = Promise.resolve();
function audioDuration(file: File): Promise<number | null> {
  const run = async (): Promise<number | null> => {
    try {
      if (file.name.toLowerCase().endsWith(".wav")) {
        const d = await wavDuration(file);
        if (d) return d;
      }
      if (file.size > 400 * 1024 * 1024) return null;
      const ctx = new AudioContext();
      try {
        return (await ctx.decodeAudioData(await file.arrayBuffer())).duration;
      } finally {
        ctx.close().catch(() => undefined);
      }
    } catch {
      return null;
    }
  };
  const p = decodeQueue.then(run, run);
  decodeQueue = p.catch(() => undefined);
  return p;
}

async function putChunk(id: string, index: number, offset: number, blob: Blob): Promise<Response> {
  return fetch(`/api/tracks/own/${id}?file=${index}&offset=${offset}`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: blob,
  });
}

// Own recording (not a MultiTracks download): asks for the song data, builds
// the song.json and uploads the stems; the server zips and the normal flow
// (track computer + practice version) follows.
export default function OwnRecordingWizard({ onClose, onDone, onError }: Props) {
  const [step, setStep] = useState(0);
  const [title, setTitle] = useState("");
  const [album, setAlbum] = useState("");
  const [key, setKey] = useState("");
  const [bpm, setBpm] = useState("");
  const [sig, setSig] = useState("4/4");
  const [tempoChanges, setTempoChanges] = useState<Change[]>([]);
  const [sigChanges, setSigChanges] = useState<Change[]>([]);
  const [showChanges, setShowChanges] = useState(false);
  const [sections, setSections] = useState<SectionRow[]>([]);
  const [stems, setStems] = useState<StemRow[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [upload, setUpload] = useState<{ index: number; sent: number[]; sizes: number[] } | null>(null);

  const song = useMemo((): OwnSong => ({
    title,
    album,
    key,
    bpm: Number(bpm),
    sig,
    tempoChanges: tempoChanges.map(c => ({ bar: Number(c.bar), bpm: Number(c.value) })),
    sigChanges: sigChanges.map(c => ({ bar: Number(c.bar), sig: c.value })),
    sections: sections.map(s => ({ name: s.name, bar: Number(s.bar) })),
    stems: stems.map(s => ({ file: s.file.name, name: s.name })),
  }), [title, album, key, bpm, sig, tempoChanges, sigChanges, sections, stems]);

  // Check one step at a time: the other parts get a harmless stand-in
  const check = useCallback((which: number): string[] => {
    const dummySections = [{ name: "x", bar: 1 }];
    const dummyStems = [{ file: "a.wav", name: "a" }];
    const probe: OwnSong = which === 0 ? { ...song, sections: dummySections, stems: dummyStems }
      : which === 1 ? { ...song, stems: dummyStems }
      : { ...song, sections: dummySections };
    const relevant = (e: string) => which === 0
      ? /titel|toonsoort|tempo|maatsoort|wissel/i.test(e)
      : which === 1 ? /sectie|maat \d+/i.test(e) && !/wissel/i.test(e)
      : /stem|audiobestand|Maximaal/i.test(e);
    return validateOwnSong(probe).filter(relevant);
  }, [song]);

  const times = useMemo(() => {
    try {
      if (check(0).length) return null;
      return sectionTimes(song);
    } catch {
      return null;
    }
  }, [song, check]);

  const longest = Math.max(0, ...stems.map(s => s.duration || 0));

  const warnings = useMemo(() => {
    const out: string[] = [];
    if (step < 2) return out;
    if (times && longest) {
      sections.forEach((s, i) => { if (times[i] >= longest) out.push(`"${s.name}" begint na het einde van de audio (${formatTime(times[i])} van ${formatTime(longest)}). Klopt de maat of het tempo?`); });
    }
    if (sections.length && Math.min(...sections.map(s => Number(s.bar))) > 1) out.push("Er is geen sectie in maat 1; het begin van het nummer heeft dan geen sectie. Voeg bijvoorbeeld Count Off of Intro in maat 1 toe.");
    const short = stems.filter(s => s.duration && longest - s.duration > 2);
    if (short.length) out.push(`Korter dan de rest: ${short.map(s => s.name).join(", ")}. Beginnen alle stems op hetzelfde punt (maat 1)?`);
    return out;
  }, [step, times, longest, sections, stems]);

  // ------------------------------------------------------------- sections

  const addSection = (preset: string) => {
    setSections(prev => {
      let name = preset;
      if (NUMBERED.includes(preset)) name = `${preset} ${prev.filter(s => s.name.startsWith(preset + " ")).length + 1}`;
      const last = [...prev].sort((a, b) => Number(a.bar) - Number(b.bar)).pop();
      const bar = !last ? 1 : Number(last.bar) + (last.name === "Count Off" ? 2 : 8) || 1;
      return [...prev, { id: uid(), name, bar: String(preset === "Count Off" ? 1 : bar) }];
    });
  };

  // ------------------------------------------------------------- stems

  const addFiles = useCallback(async (files: File[]) => {
    const audio = files.filter(f => AUDIO_EXTENSIONS.some(e => f.name.toLowerCase().endsWith(e)) && !f.name.startsWith("._"));
    const skipped = files.length - audio.length;
    if (skipped) onError(`${skipped} bestand(en) overgeslagen: alleen audio (wav, m4a, aif, mp3, flac).`);
    const rows = audio.map(file => ({ id: uid(), file, name: stemNameFromFile(file.name), duration: null as number | null }));
    setStems(prev => {
      const have = new Set(prev.map(s => s.file.name + s.file.size));
      return [...prev, ...rows.filter(r => !have.has(r.file.name + r.file.size))].slice(0, MAX_OWN_STEMS);
    });
    for (const row of rows) {
      audioDuration(row.file).then(d => setStems(prev => prev.map(s => (s.id === row.id ? { ...s, duration: d } : s))));
    }
  }, [onError]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: addFiles,
    accept: { "audio/*": AUDIO_EXTENSIONS },
    disabled: !!upload,
  });

  // ------------------------------------------------------------- navigation

  const next = () => {
    const errors = check(step);
    setProblems(errors);
    if (!errors.length) setStep(step + 1);
  };

  const totalSize = stems.reduce((a, s) => a + s.file.size, 0);

  // ------------------------------------------------------------- upload

  const start = async () => {
    const all = validateOwnSong(song);
    if (all.length) { setProblems(all); return; }
    setProblems([]);
    const sizes = stems.map(s => s.file.size);
    setUpload({ index: 0, sent: sizes.map(() => 0), sizes });
    try {
      const res = await fetch("/api/tracks/own", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...song, files: stems.map(s => ({ name: s.file.name, size: s.file.size })) }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
      const id: string = data.id;
      let chunk: number = data.chunkSize;
      let received: number[] = sizes.map(() => 0);
      if (data.resumed) {
        const r = await fetch(`/api/tracks/own/${id}`, { cache: "no-store" });
        const d = await r.json();
        if (r.ok && Array.isArray(d.received)) received = d.received;
      }
      const sent = [...received];

      for (let i = 0; i < stems.length; i++) {
        const file = stems[i].file;
        let offset = sent[i];
        let failures = 0;
        while (offset < file.size) {
          setUpload({ index: i, sent: [...sent], sizes });
          let r: Response;
          try {
            r = await putChunk(id, i, offset, file.slice(offset, offset + chunk));
          } catch {
            if (++failures > 5) throw new Error("Verbinding verbroken tijdens uploaden. Maak dezelfde opname opnieuw om verder te gaan.");
            await new Promise(res2 => setTimeout(res2, 2000 * failures));
            continue;
          }
          if (r.status === 413 && chunk > MIN_CHUNK) { chunk = Math.max(MIN_CHUNK, Math.floor(chunk / 2)); continue; }
          const d = await r.json().catch(() => ({}));
          if (r.status === 409 && typeof d.received === "number") { offset = sent[i] = d.received; continue; }
          if (!r.ok) {
            if (++failures > 5) throw new Error(d.error || `Uploaden mislukt (HTTP ${r.status})`);
            await new Promise(res2 => setTimeout(res2, 2000 * failures));
            continue;
          }
          failures = 0;
          offset = sent[i] = d.received;
        }
        setUpload({ index: i, sent: [...sent], sizes });
      }

      setUpload({ index: stems.length, sent: [...sent], sizes });
      const done = await fetch(`/api/tracks/own/${id}?complete=1`, { method: "POST" });
      const dd = await done.json().catch(() => ({}));
      if (!done.ok || dd.error) throw new Error(dd.error || `HTTP ${done.status}`);
      onDone(title.trim());
      onClose();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Uploaden mislukt");
      setUpload(null);
    }
  };

  const sentTotal = upload ? upload.sent.reduce((a, b) => a + b, 0) : 0;

  // ------------------------------------------------------------- render

  const field = (label: string, input: React.ReactNode, hint?: string) => (
    <label className="own-field">
      <span className="trk-label">{label}</span>
      {input}
      {hint && <small>{hint}</small>}
    </label>
  );

  return (
    <section className="glass-card own-wizard">
      <div className="own-head">
        <h3 className="trk-title"><Music2 size={18} style={{ color: "#22c55e" }} /> Eigen opname toevoegen</h3>
        <button className="trk-icon-btn" onClick={onClose} disabled={!!upload} aria-label="Sluiten"><X size={16} /></button>
      </div>
      <ol className="own-steps">
        {STEPS.map((s, i) => (
          <li key={s} className={i === step ? "on" : i < step ? "done" : ""}>{i < step ? <CheckCircle2 size={13} /> : `${i + 1}.`} {s}</li>
        ))}
      </ol>

      {step === 0 && (
        <div className="own-body">
          <div className="own-grid">
            {field("Titel", <input className="input-field" value={title} onChange={e => setTitle(e.target.value)} placeholder="Naam van het nummer" />)}
            {field("Album of bron (optioneel)", <input className="input-field" value={album} onChange={e => setAlbum(e.target.value)} placeholder="Eigen opname" />)}
            {field("Toonsoort", (
              <select className="input-field" value={key} onChange={e => setKey(e.target.value)}>
                <option value="">Kies…</option>
                {OWN_KEYS.map(k => <option key={k} value={k}>{k}</option>)}
              </select>
            ), "Voor de padspeler en de weergave")}
            {field("Tempo (bpm)", <input className="input-field" type="number" min={20} max={400} step="0.01" value={bpm} onChange={e => setBpm(e.target.value)} placeholder="bijv. 112" />, "Het tempo waarmee de opname begint")}
            {field("Maatsoort", (
              <select className="input-field" value={sig} onChange={e => setSig(e.target.value)}>
                {OWN_SIGS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            ))}
          </div>

          <button className="own-link" onClick={() => setShowChanges(!showChanges)}>
            {showChanges ? "Verberg" : "Wisselt het tempo of de maatsoort tijdens het nummer?"}
          </button>
          {showChanges && (
            <div className="own-changes">
              {([["Tempowissels", tempoChanges, setTempoChanges, "bpm"], ["Maatsoortwissels", sigChanges, setSigChanges, "maatsoort"]] as const).map(([label, list, setList, unit]) => (
                <div key={label}>
                  <span className="trk-label">{label}</span>
                  {list.map(c => (
                    <div key={c.id} className="own-change-row">
                      <span>vanaf maat</span>
                      <input className="input-field" type="number" min={2} value={c.bar} onChange={e => setList(list.map(x => (x.id === c.id ? { ...x, bar: e.target.value } : x)))} />
                      {unit === "bpm"
                        ? <input className="input-field" type="number" min={20} max={400} value={c.value} onChange={e => setList(list.map(x => (x.id === c.id ? { ...x, value: e.target.value } : x)))} placeholder="bpm" />
                        : (
                          <select className="input-field" value={c.value} onChange={e => setList(list.map(x => (x.id === c.id ? { ...x, value: e.target.value } : x)))}>
                            {OWN_SIGS.map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                        )}
                      <button className="trk-icon-btn" onClick={() => setList(list.filter(x => x.id !== c.id))} aria-label="Verwijderen"><Trash2 size={14} /></button>
                    </div>
                  ))}
                  <button className="own-add" onClick={() => setList([...list, { id: uid(), bar: "", value: unit === "bpm" ? bpm : "3/4" }])}><Plus size={13} /> {label.slice(0, -1)} toevoegen</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {step === 1 && (
        <div className="own-body">
          <p className="trk-arr-hint">
            Geef per sectie de <strong>maat</strong> waarin hij begint, zoals in je opname-programma (maat 1 = het begin van de audio).
            Rechts zie je de tijd die daarbij hoort; controleer die met de tijdlijn in je programma.
          </p>
          <div className="own-chips">
            {PRESETS.filter(p => p !== "Count Off" || !sections.some(s => s.name === "Count Off")).map(p => (
              <button key={p} className="own-chip" onClick={() => addSection(p)}><Plus size={12} /> {p}</button>
            ))}
          </div>
          <datalist id="own-section-names">{PRESETS.map(p => <option key={p} value={p} />)}</datalist>
          <div className="own-sections">
            {sections.map((s, index) => {
              return (
                <div key={s.id} className="own-section-row">
                  <input className="input-field" list="own-section-names" value={s.name} onChange={e => setSections(sections.map(x => (x.id === s.id ? { ...x, name: e.target.value } : x)))} placeholder="Naam" />
                  <span>maat</span>
                  <input className="input-field own-bar" type="number" min={1} value={s.bar} onChange={e => setSections(sections.map(x => (x.id === s.id ? { ...x, bar: e.target.value } : x)))} />
                  <span className="trk-meta own-time">{times && Number.isFinite(times[index]) && s.bar ? formatTime(times[index]) : "—"}</span>
                  <button className="trk-icon-btn" onClick={() => setSections(sections.filter(x => x.id !== s.id))} aria-label="Verwijderen"><Trash2 size={14} /></button>
                </div>
              );
            })}
            {!sections.length && <p className="trk-arr-hint">Nog geen secties. Tik hierboven op een soort sectie om te beginnen.</p>}
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="own-body">
          <div {...getRootProps({ className: `trk-drop${isDragActive ? " active" : ""}` })}>
            <input {...getInputProps()} />
            <UploadCloud size={22} />
            <span className="trk-drop-title">Sleep de stems hierheen of tik om ze te kiezen</span>
            <small>Eén audiobestand per stem (wav, m4a, aif, mp3, flac), allemaal beginnend bij maat 1. Je kunt er meerdere tegelijk kiezen.</small>
          </div>
          {stems.length > 0 && (
            <div className="own-stems">
              {stems.map(s => {
                const g = groupFor(s.name);
                return (
                  <div key={s.id} className="own-stem-row">
                    <input className="input-field" value={s.name} onChange={e => setStems(stems.map(x => (x.id === s.id ? { ...x, name: e.target.value } : x)))} />
                    <span className={`mx-badge ${g.fallback ? "muted" : "out"}`} title={g.fallback ? "De naam past bij geen groep; hij komt bij Pads / Strings / FX" : "Groep op de mixer"}>{g.group}</span>
                    {g.live && <span className="mx-badge live" title="Dit speelt de band normaal zelf: staat standaard gemute">LIVE</span>}
                    <span className="trk-meta own-time">{s.duration ? formatTime(s.duration) : "…"} · {mb(s.file.size)}</span>
                    <button className="trk-icon-btn" onClick={() => setStems(stems.filter(x => x.id !== s.id))} aria-label="Verwijderen"><Trash2 size={14} /></button>
                  </div>
                );
              })}
            </div>
          )}
          <p className="trk-arr-hint">De naam van een stem bepaalt de groep: bijvoorbeeld &quot;Drums&quot;, &quot;Bass&quot;, &quot;Keys&quot;, &quot;EG 1&quot;, &quot;Alto&quot;, &quot;Pad&quot;, &quot;Guide&quot;. Je kunt de naam hierboven aanpassen. Click 1/4, 1/8 en 1/16 maakt de app zelf.</p>
        </div>
      )}

      {step === 3 && (
        <div className="own-body">
          <div className="own-summary">
            <div><span className="trk-label">Nummer</span><strong>{title.trim()}</strong><span className="trk-meta">{key} · {bpm} bpm · {sig}</span></div>
            <div><span className="trk-label">Secties</span><span>{sections.length} · {[...sections].sort((a, b) => Number(a.bar) - Number(b.bar)).map(s => s.name).join(", ")}</span></div>
            <div><span className="trk-label">Stems</span><span>{stems.length} · {mb(totalSize)}</span></div>
          </div>
          {upload ? (
            <div className="own-progress">
              <span className="trk-drop-title"><Loader2 size={16} className="trk-spin" /> {upload.index < stems.length ? `${stems[upload.index].name} (${upload.index + 1} van ${stems.length})` : "Klaarmaken op de server…"}</span>
              <div className="trk-progress"><div style={{ width: `${totalSize ? (sentTotal / totalSize) * 100 : 0}%` }} /></div>
              <small>{mb(sentTotal)} van {mb(totalSize)} · laat dit venster open</small>
            </div>
          ) : (
            <p className="trk-arr-hint">Na het uploaden maakt de server er één pakket van en zet het klaar voor de track-computer en de oefenspeler. Dat duurt even.</p>
          )}
        </div>
      )}

      {problems.length > 0 && (
        <ul className="own-problems">
          {problems.map(p => <li key={p}><AlertTriangle size={13} /> {p}</li>)}
        </ul>
      )}
      {warnings.length > 0 && !problems.length && (
        <ul className="own-warnings">
          {warnings.map(w => <li key={w}><AlertTriangle size={13} /> {w}</li>)}
        </ul>
      )}

      <div className="own-nav">
        <button className="own-btn" onClick={() => { setProblems([]); setStep(step - 1); }} disabled={step === 0 || !!upload}><ChevronLeft size={15} /> Terug</button>
        {step < 3
          ? <button className="own-btn primary" onClick={next}>Volgende <ChevronRight size={15} /></button>
          : <button className="own-btn primary" onClick={start} disabled={!!upload}><UploadCloud size={15} /> Uploaden</button>}
      </div>
    </section>
  );
}
