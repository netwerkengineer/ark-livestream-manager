"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Play, Pause, Square, Repeat, Headphones, ListMusic, SlidersHorizontal, Search,
  ChevronDown, ChevronUp, Loader2, AlertTriangle, RotateCcw, Music, CalendarDays, Minus, Plus, Gauge, Volume2, VolumeX,
} from "lucide-react";
import Fader from "../tracks/Fader";
import { faderToVolume, volumeToFader, dbToFader, formatDb, meterPercent, UNITY } from "../tracks/faderLaw";
import { parseSongName, sectionColor } from "../tracks/songName";
import { formatTime } from "../tracks/useReaper";
import {
  PracticeEngine, UnauthorizedError, MIN_RATE, MAX_RATE,
  type JumpMode, type PracticeManifest, type PracticeSection, type StemMix, type GroupMix,
} from "./practiceEngine";

interface SongEntry { id: string; name: string; status: string; message: string | null }
interface SetlistEntry { title: string; artist: string; id: string | null }
interface LyricSlide { t: number; slide: number; lines: string[] }

const MODES: { id: JumpMode; label: string; hint: string }[] = [
  { id: "end", label: "Einde sectie", hint: "Springen als de huidige sectie uit is" },
  { id: "bar", label: "Volgende maat", hint: "Springen op de eerste tel van de volgende maat" },
  { id: "now", label: "Direct", hint: "Meteen springen" },
];

const MIX_KEY = (id: string) => `practice-mix:${id}`;
const TEMPO_KEY = (id: string) => `practice-tempo:${id}`;
const MASTER_KEY = "ark-practice-master";     // one master for all songs: it is the volume of this listening place
const MASTER_MAX = dbToFader(6);

function readStorage(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeStorage(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // private mode / blocked storage: the mix just isn't remembered
  }
}

// Practice player: band members play the stems of a song in their own
// browser, with their own mix (solo their part, mute their instrument),
// sections, loop and the lyrics. Has nothing to do with REAPER in church.
export default function PracticePlayer({ stage }: { stage?: boolean }) {
  const [songs, setSongs] = useState<SongEntry[]>([]);
  const [setlist, setSetlist] = useState<SetlistEntry[]>([]);
  const [date, setDate] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [listError, setListError] = useState<string | null>(null);

  const [songId, setSongId] = useState<string | null>(null);
  const [manifest, setManifest] = useState<PracticeManifest | null>(null);
  const [lyrics, setLyrics] = useState<LyricSlide[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [songError, setSongError] = useState<string | null>(null);

  const engineRef = useRef<PracticeEngine | null>(null);
  const [, setRevision] = useState(0);
  const rerender = useCallback(() => setRevision(r => r + 1), []);
  const [position, setPosition] = useState(0);
  const [meters, setMeters] = useState<number[]>([]);
  const [mix, setMixState] = useState<{ stems: StemMix[]; groups: Record<string, GroupMix> } | null>(null);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [mode, setMode] = useState<JumpMode>("end");

  useEffect(() => {
    const saved = readStorage("practice-mode");
    if (saved === "end" || saved === "bar" || saved === "now") setMode(saved);
  }, []);

  // ------------------------------------------------------------- song list

  const loadList = useCallback(async () => {
    try {
      const res = await fetch("/api/tracks/practice", { cache: "no-store" });
      if (res.status === 401) throw new Error("Je bent niet (meer) ingelogd.");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Laden mislukt");
      setSongs(data.songs || []);
      setSetlist(data.setlist || []);
      setDate(data.date || null);
      setListError(null);
      return data.songs as SongEntry[];
    } catch (err) {
      setListError(err instanceof Error ? err.message : String(err));
      return null;
    }
  }, []);

  useEffect(() => {
    loadList();
  }, [loadList]);

  // While practice versions are being made: check now and then
  const busy = songs.some(s => s.status === "queued" || s.status === "processing");
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(loadList, 15000);
    return () => clearInterval(t);
  }, [busy, loadList]);

  // ------------------------------------------------------------- open a song

  const openSong = useCallback(async (id: string) => {
    if (engineRef.current) {
      await engineRef.current.close();
      engineRef.current = null;
    }
    setSongId(id);
    setManifest(null);
    setLyrics(null);
    setMixState(null);
    setSongError(null);
    setOpenGroup(null);
    setPosition(0);
    setLoading(true);
    try {
      const res = await fetch(`/api/tracks/practice/${id}`, { cache: "no-store" });
      const data = await res.json();
      if (res.status === 401) throw new Error("Je bent niet (meer) ingelogd.");
      if (!res.ok) throw new Error(data.message ? `${data.error} (${data.message})` : data.error || "Laden mislukt");
      const m: PracticeManifest = data.manifest;
      const engine = new PracticeEngine(
        m,
        n => `/api/tracks/practice/${id}/seg/${n}?v=${data.v}`,
        `/api/tracks/practice/${id}/calibration?v=${data.v}`,
      );
      engine.onChange = rerender;
      // Own mix of this song from last time (per stem name)
      try {
        const saved = JSON.parse(readStorage(MIX_KEY(id)) || "null");
        if (saved?.stems) {
          engine.setMix(
            m.stems.map((s, i) => ({ ...engine.mix.stems[i], ...(saved.stems[s.name] || {}) })),
            saved.groups || {},
          );
        }
      } catch {
        // unreadable - default mix
      }
      engineRef.current = engine;
      setManifest(m);
      setLyrics(data.lyrics || null);
      setMixState({ ...engine.mix });
      await engine.init();
      // Tempo of this song from last time
      const savedRate = Number(readStorage(TEMPO_KEY(id)));
      if (savedRate && engine.canTempo) engine.setRate(savedRate);
      try { const mm = JSON.parse(readStorage(MASTER_KEY) || "null"); if (mm) engine.setMaster({ volume: Number(mm.volume) || 0, mute: !!mm.mute }); } catch { /* default: 0 dB */ }
    } catch (err) {
      setSongError(err instanceof UnauthorizedError ? "Je bent niet (meer) ingelogd." : err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [rerender]);

  useEffect(() => () => { engineRef.current?.close(); }, []);

  const engine = engineRef.current;
  const playing = !!engine?.playing;

  // Position and meters ~12x per second while playing
  useEffect(() => {
    if (!playing) {
      if (engine) setPosition(engine.position);
      setMeters([]);
      return;
    }
    const t = setInterval(() => {
      const e = engineRef.current;
      if (!e) return;
      setPosition(e.position);
      setMeters(e.meters());
    }, 80);
    return () => clearInterval(t);
  }, [playing, engine]);

  // Space = play/pause
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" || !engineRef.current) return;
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, select, button, [role=slider]")) return;
      e.preventDefault();
      const en = engineRef.current;
      if (en.playing) en.pause();
      else en.play();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ------------------------------------------------------------- mix

  const saveMix = useCallback((m: { stems: StemMix[]; groups: Record<string, GroupMix> }) => {
    const en = engineRef.current;
    if (!en || !songId) return;
    const stems = Object.fromEntries(en.m.stems.map((s, i) => [s.name, m.stems[i]]));
    writeStorage(MIX_KEY(songId), JSON.stringify({ stems, groups: m.groups }));
  }, [songId]);

  const updateStem = (i: number, patch: Partial<StemMix>, save = true) => {
    const en = engineRef.current;
    if (!en) return;
    en.setStem(i, patch);
    const m = { ...en.mix };
    setMixState(m);
    if (save) saveMix(m);
  };

  const updateGroup = (name: string, patch: Partial<GroupMix>, save = true) => {
    const en = engineRef.current;
    if (!en) return;
    en.setGroup(name, patch);
    const m = { ...en.mix };
    setMixState(m);
    if (save) saveMix(m);
  };

  const soloGroup = (name: string) => {
    const en = engineRef.current;
    if (!en || !mix) return;
    const idx = en.m.stems.map((s, i) => (s.group === name ? i : -1)).filter(i => i >= 0);
    const allOn = idx.every(i => mix.stems[i].solo);
    en.setMix(mix.stems.map((s, i) => (idx.includes(i) ? { ...s, solo: !allOn } : s)), {});
    const m = { ...en.mix };
    setMixState(m);
    saveMix(m);
  };

  const resetMix = () => {
    const en = engineRef.current;
    if (!en || !songId) return;
    en.setMix(
      en.m.stems.map(s => ({ volume: 1, mute: s.muted, solo: false })),
      Object.fromEntries(en.m.groups.map(g => [g, { volume: 1, mute: false }])),
    );
    writeStorage(MIX_KEY(songId), null);
    setMixState({ ...en.mix });
  };

  const changeMaster = (patch: { volume?: number; mute?: boolean }) => {
    const en = engineRef.current;
    if (!en) return;
    en.setMaster(patch);
    writeStorage(MASTER_KEY, JSON.stringify({ volume: en.masterVolume, mute: en.masterMute }));
  };

  const changeRate = (rate: number) => {
    const en = engineRef.current;
    if (!en || !songId) return;
    en.setRate(rate);
    writeStorage(TEMPO_KEY(songId), en.rate === 1 ? null : String(en.rate));
  };

  // ------------------------------------------------------------- derived

  const song = manifest ? parseSongName(manifest.title) : null;
  const current = manifest?.sections.find(s => position >= s.start && position < s.end) || null;
  const pending = engine?.pending?.section.id ?? null;
  const looping = engine?.loop?.id ?? null;

  const lyricIndex = useMemo(() => {
    if (!lyrics?.length) return -1;
    let idx = -1;
    for (let i = 0; i < lyrics.length; i++) {
      if (lyrics[i].t <= position + 0.02) idx = i;
      else break;
    }
    return idx;
  }, [lyrics, position]);
  const lyricNow = lyricIndex >= 0 ? lyrics![lyricIndex] : null;
  const lyricNext = lyrics && lyricIndex + 1 < lyrics.length ? lyrics[lyricIndex + 1] : null;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return songs.filter(s => !q || s.name.toLowerCase().includes(q));
  }, [songs, search]);

  const groupsWithStems = manifest ? manifest.groups.filter(g => manifest.stems.some(s => s.group === g)) : [];

  const jump = (section: PracticeSection) => {
    const en = engineRef.current;
    if (!en) return;
    if (pending === section.id) en.cancelJump();
    else en.jump(section, mode);
    setPosition(en.position);
  };

  const toggleLoop = () => {
    const en = engineRef.current;
    if (!en) return;
    en.setLoop(looping ? null : current);
  };

  const seekBar = (e: React.MouseEvent<HTMLDivElement>) => {
    const en = engineRef.current;
    if (!en || !manifest) return;
    const rect = e.currentTarget.getBoundingClientRect();
    en.seek(((e.clientX - rect.left) / rect.width) * manifest.duration);
    setPosition(en.position);
  };

  const stripMeter = (i: number) => (meters[i] !== undefined ? meterPercent(meters[i]) : 0);

  const statusLabel = (s: SongEntry) =>
    s.status === "ready" ? null : s.status === "error" ? "mislukt" : s.message || "wordt voorbereid";

  // ------------------------------------------------------------- render

  const songButton = (id: string, label: string, sub?: string | null, disabled?: boolean) => (
    <button
      key={id + label}
      className={`prc-song${songId === id ? " on" : ""}`}
      onClick={() => openSong(id)}
      disabled={disabled}
    >
      <Music size={14} />
      <span className="prc-song-name">{label}</span>
      {sub && <small>{sub}</small>}
    </button>
  );

  return (
    <div className={`prc${stage ? " stage" : ""}`}>
      <div className="prc-top">
        {/* Songs */}
        <section className="glass-card prc-list">
          <h3 className="trk-title"><ListMusic size={18} style={{ color: "#06b6d4" }} /> Nummers</h3>
          {listError && <p className="trk-warn"><AlertTriangle size={14} /> {listError}</p>}
          {setlist.length > 0 && (
            <div className="prc-group">
              <span className="trk-label"><CalendarDays size={12} /> Dienst {date ? new Date(date + "T12:00:00").toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short" }) : ""}</span>
              {setlist.map((s, i) => {
                const entry = s.id ? songs.find(x => x.id === s.id) : null;
                if (!entry) {
                  return (
                    <div key={`sl${i}`} className="prc-song missing" title="Geen tracks voor dit nummer">
                      <Music size={14} /><span className="prc-song-name">{s.title}</span><small>geen tracks</small>
                    </div>
                  );
                }
                return songButton(entry.id, s.title, statusLabel(entry), entry.status !== "ready");
              })}
            </div>
          )}
          <div className="prc-group">
            <span className="trk-label">Alle nummers</span>
            <label className="prc-search">
              <Search size={14} />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Zoeken" />
            </label>
            <div className="prc-scroll">
              {filtered.map(s => songButton(s.id, parseSongName(s.name).title, statusLabel(s) || parseSongName(s.name).key, s.status !== "ready"))}
              {!filtered.length && <p className="trk-arr-hint">Geen nummers gevonden.</p>}
            </div>
          </div>
        </section>

        {/* Transport + lyrics */}
        <div className="prc-main">
          <section className="glass-card trk-transport prc-transport">
            <div className="trk-song">
              <span className="trk-label">Oefenen</span>
              <strong>{song?.title || (loading ? "Laden…" : "Kies een nummer")}</strong>
              {song?.key && (
                <span className="trk-meta">
                  {song.key} · {engine && engine.rate !== 1 && song.bpm ? `${Math.round(Number(song.bpm) * engine.rate)} BPM (origineel ${song.bpm})` : `${song.bpm} BPM`}
                </span>
              )}
            </div>
            <div className="trk-transport-buttons">
              <button
                className={`trk-t-btn play${playing ? " active" : ""}`}
                onClick={() => (playing ? engine?.pause() : engine?.play())}
                disabled={!engine || loading}
                title={playing ? "Pauze (spatie)" : "Afspelen (spatie)"}
              >
                {playing ? <Pause size={22} /> : <Play size={22} />}
              </button>
              <button className="trk-t-btn stop" onClick={() => { engine?.stop(); setPosition(0); }} disabled={!engine} title="Stop (naar begin)">
                <Square size={18} />
              </button>
            </div>
            <div className="trk-clock">
              <span className="trk-time">{formatTime(position)}</span>
              <span className="trk-meta">{manifest ? formatTime(manifest.duration) : "-"}</span>
            </div>
            <div className="prc-tempo" title={engine && !engine.canTempo ? "Tempo aanpassen kan niet in deze browser" : "Tempo (toonhoogte blijft gelijk)"}>
              <span className="trk-label"><Gauge size={12} /> Tempo</span>
              <div className="prc-tempo-row">
                <button className="prc-tempo-btn" onClick={() => changeRate((engine?.rate || 1) - 0.05)} disabled={!engine?.canTempo || (engine?.rate || 1) <= MIN_RATE} aria-label="Langzamer"><Minus size={14} /></button>
                <button className={`prc-tempo-val${engine && engine.rate !== 1 ? " on" : ""}`} onClick={() => changeRate(1)} disabled={!engine?.canTempo} title="Terug naar 100%">
                  {Math.round((engine?.rate || 1) * 100)}%
                </button>
                <button className="prc-tempo-btn" onClick={() => changeRate((engine?.rate || 1) + 0.05)} disabled={!engine?.canTempo || (engine?.rate || 1) >= MAX_RATE} aria-label="Sneller"><Plus size={14} /></button>
              </div>
            </div>
            <div className={`trk-master prc-master${engine?.masterMute ? " muted" : ""}`} title="Master: alle sporen samen (dubbelklik op de schuif = 0 dB)">
              <span className="trk-label">Master</span>
              <button className={`trk-icon-btn${engine?.masterMute ? " pinned" : ""}`} onClick={() => changeMaster({ mute: !engine?.masterMute })} disabled={!engine} aria-label={engine?.masterMute ? "Master aan" : "Master dempen"}>
                {engine?.masterMute ? <VolumeX size={14} /> : <Volume2 size={14} />}
              </button>
              <input
                className="trk-master-slider"
                type="range" min={0} max={MASTER_MAX} step={0.002}
                value={Math.min(MASTER_MAX, volumeToFader(engine?.masterVolume ?? 1))}
                onChange={e => changeMaster({ volume: faderToVolume(parseFloat(e.target.value)) })}
                onDoubleClick={() => changeMaster({ volume: 1 })}
                disabled={!engine}
                aria-label="Master volume"
              />
              <span className="trk-meta trk-master-db">{formatDb(Math.min(MASTER_MAX, volumeToFader(engine?.masterVolume ?? 1)))} dB</span>
            </div>
            <div className="trk-current">
              <span className="trk-label">Sectie</span>
              <strong>{current?.name || "—"}</strong>
              {engine?.buffering && <span className="trk-meta"><Loader2 size={12} className="prc-spin" /> laden…</span>}
            </div>
          </section>

          {songError && <p className="trk-warn"><AlertTriangle size={14} /> {songError}</p>}
          {engine?.error && <p className="trk-warn"><AlertTriangle size={14} /> {engine.error}</p>}
          {engine?.warning && <p className="trk-warn"><AlertTriangle size={14} /> {engine.warning}</p>}

          {manifest && (
            <div className="prc-bar" onClick={seekBar} title="Tik om daarheen te gaan">
              {manifest.sections.map(s => (
                <span
                  key={s.id}
                  style={{ left: `${(s.start / manifest.duration) * 100}%`, width: `${((s.end - s.start) / manifest.duration) * 100}%`, background: sectionColor(s.name) }}
                />
              ))}
              <i style={{ left: `${(position / manifest.duration) * 100}%` }} />
            </div>
          )}

          <section className="glass-card prc-lyrics">
            {!manifest ? (
              <p className="prc-lyrics-empty"><Headphones size={28} /> Kies links een nummer om te oefenen.</p>
            ) : !lyrics ? (
              <p className="prc-lyrics-empty">Geen tekst gekoppeld aan dit nummer.</p>
            ) : (
              <>
                <div className="prc-lyrics-now">
                  {(lyricNow?.lines.length ? lyricNow.lines : [" "]).map((l, i) => <p key={i}>{l}</p>)}
                </div>
                {lyricNext && lyricNext.lines.length > 0 && (
                  <div className="prc-lyrics-next">{lyricNext.lines.join(" / ")}</div>
                )}
              </>
            )}
          </section>
        </div>
      </div>

      {manifest && (
        <section className="glass-card trk-sections">
          <div className="trk-sections-head">
            <h3 className="trk-title"><ListMusic size={18} style={{ color: "#06b6d4" }} /> Arrangement</h3>
            <div className="trk-modes" role="radiogroup" aria-label="Sprongmoment">
              {MODES.map(m => (
                <button
                  key={m.id}
                  role="radio"
                  aria-checked={mode === m.id}
                  className={`trk-mode${mode === m.id ? " on" : ""}`}
                  title={m.hint}
                  onClick={() => { setMode(m.id); writeStorage("practice-mode", m.id); }}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <button
              className={`trk-loop${looping ? " on" : ""}`}
              onClick={toggleLoop}
              disabled={!looping && !current}
              title="Huidige sectie herhalen tot je hem weer uitzet"
            >
              <Repeat size={16} /> {looping ? "Loop aan" : "Loop sectie"}
            </button>
          </div>
          <div className="trk-section-grid">
            {manifest.sections.map(r => {
              const isCurrent = r.id === current?.id;
              const isPending = r.id === pending;
              const isLoop = r.id === looping;
              return (
                <button
                  key={r.id}
                  className={`trk-section${isCurrent ? " current" : ""}${isPending ? " pending" : ""}${isLoop ? " loop" : ""}`}
                  style={{ "--sec": sectionColor(r.name) } as React.CSSProperties}
                  onClick={() => jump(r)}
                >
                  <span className="trk-section-name">{r.name}</span>
                  <small>{isPending ? "volgt…" : isLoop ? "loop" : formatTime(r.start)}</small>
                  {isCurrent && playing && (
                    <span className="trk-section-progress" style={{ width: `${Math.min(100, ((position - r.start) / (r.end - r.start)) * 100)}%` }} />
                  )}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {manifest && mix && (
        <section className="glass-card">
          <div className="mx-head">
            <h3 className="trk-title"><SlidersHorizontal size={18} style={{ color: "var(--primary)" }} /> Mix</h3>
            <span className="trk-arr-hint" style={{ margin: 0 }}>Jouw mix wordt per nummer op dit apparaat onthouden.</span>
            <button className="mx-unmute" onClick={resetMix}><RotateCcw size={13} /> Standaardmix</button>
          </div>
          <div className="mx-rack">
            {groupsWithStems.map(g => {
              const gm = mix.groups[g] || { volume: 1, mute: false };
              const idx = manifest.stems.map((s, i) => (s.group === g ? i : -1)).filter(i => i >= 0);
              const soloed = idx.every(i => mix.stems[i].solo);
              const f = volumeToFader(gm.volume);
              const gmeter = Math.max(0, ...idx.map(stripMeter));
              return (
                <div key={g} className={`mx-strip bus${gm.mute ? " muted" : ""}${soloed ? " soloed" : ""}`}>
                  <span className="mx-value">{formatDb(f)}</span>
                  <Fader value={f} meter={gm.mute ? 0 : gmeter} label={g} bus onChange={(v, final) => updateGroup(g, { volume: faderToVolume(v) }, final)} />
                  <div className="mx-ms">
                    <button className={`mx-btn mute${gm.mute ? " on" : ""}`} onClick={() => updateGroup(g, { mute: !gm.mute })} aria-pressed={gm.mute} title="Mute groep">M</button>
                    <button className={`mx-btn solo${soloed ? " on" : ""}`} onClick={() => soloGroup(g)} aria-pressed={soloed} title="Solo groep">S</button>
                  </div>
                  <span className="mx-name" title={g}>{g}</span>
                  <div className="mx-tags">{gm.mute && <span className="mx-badge muted">MUTE</span>}</div>
                  <button className={`mx-stems${openGroup === g ? " open" : ""}`} onClick={() => setOpenGroup(openGroup === g ? null : g)} title="Stems van deze groep">
                    {idx.length} stems {openGroup === g ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {manifest && mix && openGroup && (
        <section className="glass-card">
          <div className="mx-head">
            <h3 className="trk-title"><SlidersHorizontal size={18} style={{ color: "#f97316" }} /> Stems – {openGroup}</h3>
          </div>
          <div className="mx-rack">
            {manifest.stems.map((s, i) => {
              if (s.group !== openGroup) return null;
              const sm = mix.stems[i];
              const f = volumeToFader(sm.volume);
              return (
                <div key={s.name + i} className={`mx-strip${sm.mute ? " muted" : ""}${sm.solo ? " soloed" : ""}`}>
                  <span className="mx-value">{formatDb(f)}</span>
                  <Fader value={f} meter={stripMeter(i)} label={s.name} onChange={(v, final) => updateStem(i, { volume: v === UNITY ? 1 : faderToVolume(v) }, final)} />
                  <div className="mx-ms">
                    <button className={`mx-btn mute${sm.mute ? " on" : ""}`} onClick={() => updateStem(i, { mute: !sm.mute })} aria-pressed={sm.mute} title="Mute">M</button>
                    <button className={`mx-btn solo${sm.solo ? " on" : ""}`} onClick={() => updateStem(i, { solo: !sm.solo })} aria-pressed={sm.solo} title="Solo">S</button>
                  </div>
                  <span className="mx-name" title={s.name}>{s.name}</span>
                  <div className="mx-tags">
                    {sm.mute && <span className="mx-badge muted">MUTE</span>}
                    {s.live && <span className="mx-badge live">LIVE</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
