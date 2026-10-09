"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { ListOrdered, Download, RefreshCw, AlertTriangle, Check, FileText, Timer, ChevronUp, ChevronDown, X } from "lucide-react";
import type { ReaperState, BridgeSong } from "@/lib/reaperControl";
import { reaperAction } from "./useReaper";
import { parseSongName } from "./songName";
import ArrangementEditor from "./ArrangementEditor";
import TimingEditor from "./TimingEditor";
import { hasDesktopEngine, isOffline, getSetlistSource, setSetlistSource, ownAdd, ownRemove, ownMove, ownPaths } from "@/lib/desktopEngine";

interface SetlistSong {
  id: string;
  title: string;
  artist: string;
  section: string;
  path: string | null;
  manual: boolean;
  local: "full" | "slim" | null;
  fetching?: boolean;   // desktop app: being fetched from the server
}

interface SetlistData {
  today: string;
  dates: string[];
  date: string | null;
  setlist: SetlistSong[];
  songs: BridgeSong[];
  loaded: string[];
  bridgeError: string | null;
  own?: boolean;     // the desktop app's own setlist (not a service from the web app)
}

interface SetlistPanelProps {
  state: ReaperState | null;
  onError: (message: string) => void;
  onStatus: (message: string) => void;
  stage?: boolean; // podium: alleen kiezen, geen songs koppelen
}

function formatDate(date: string): string {
  return new Date(date + "T12:00:00").toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short" });
}

export default function SetlistPanel({ state, onError, onStatus, stage }: SetlistPanelProps) {
  const [data, setData] = useState<SetlistData | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<SetlistSong | null>(null);
  const [timing, setTiming] = useState<SetlistSong | null>(null);
  // Desktop app: a service setlist from the web app or an own list that is kept on this computer
  const [desktop, setDesktop] = useState(false);
  const [source, setSource] = useState<"service" | "own">("service");
  // Kept in a ref so a new onError from the parent doesn't re-trigger loading
  const onErrorRef = useRef(onError);
  useEffect(() => { onErrorRef.current = onError; });

  const load = useCallback(async (d: string | null) => {
    try {
      const res = await fetch(`/api/reaper/setlist${d ? `?date=${encodeURIComponent(d)}` : ""}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error || `HTTP ${res.status}`);
      setData(json);
      setDate(json.date);
    } catch (err) {
      onErrorRef.current(err instanceof Error ? err.message : "Setlist laden mislukt");
    }
  }, []);

  useEffect(() => {
    if (hasDesktopEngine()) { setDesktop(true); setSource(getSetlistSource()); }
    load(null);
  }, [load]);

  const chooseSource = (v: "service" | "own") => { setSetlistSource(v); setSource(v); load(null); };
  const ownEdit = async (fn: () => void) => { fn(); await load(date); };

  const activePath = state?.bridge?.tabs.find(t => t.active)?.path;
  const openPaths = new Set(state?.bridge?.tabs.map(t => t.path) || []);
  const playing = state?.playState === 1;

  // Desktop app: the songs of the list are put in memory by themselves (no button): a transition during
  // playing needs the next song to be ready. Only when the list changes and nothing is playing.
  const autoLoaded = useRef("");
  useEffect(() => {
    if (!desktop || !data || playing) return;
    const paths = data.setlist.map(s => s.path).filter((p): p is string => !!p);
    const key = paths.join("|");
    if (!paths.length || key === autoLoaded.current) return;
    autoLoaded.current = key;
    reaperAction({ action: "load", date: data.date || "own" }, "/api/reaper/setlist").catch(() => { autoLoaded.current = ""; });
  }, [desktop, data, playing]);

  const pendingSong = state?.bridge?.pendingSong;

  // While playing: transition at the chosen jump moment (tap again to cancel);
  // stopped: set the song up right away
  const selectSong = async (song: SetlistSong) => {
    if (!song.path || song.path === activePath) return;
    setBusy(true);
    try {
      if (playing && song.path === pendingSong) await reaperAction({ action: "songCancel" });
      else await reaperAction({ action: "song", path: song.path, ...(playing ? { mode: state?.bridge?.mode || "end" } : {}) });
    } catch (err) {
      onError(err instanceof Error ? err.message : "Song kiezen mislukt");
    } finally {
      setBusy(false);
    }
  };

  const loadIntoReaper = async () => {
    if (!date) return;
    if (playing) {
      onError("Stop eerst het afspelen voordat je de setlist klaarzet.");
      return;
    }
    setBusy(true);
    try {
      await reaperAction({ action: "load", date }, "/api/reaper/setlist");
      onStatus("Setlist staat klaar in REAPER.");
      await load(date);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Klaarzetten mislukt");
    } finally {
      setBusy(false);
    }
  };

  const link = async (song: SetlistSong, path: string) => {
    try {
      await reaperAction({ action: "link", title: song.title, path: path || null }, "/api/reaper/setlist");
      await load(date);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Koppelen mislukt");
    }
  };

  const matched = data?.setlist.filter(s => s.path).length || 0;

  return (
    <section className={`glass-card trk-setlist${stage ? " stage" : ""}`}>
      <div className="trk-setlist-head">
        <h3 className="trk-title"><ListOrdered size={18} style={{ color: "var(--primary)" }} /> Setlist</h3>
        {desktop && !isOffline() && (
          <span className="trk-src">
            <button className={`trk-icon-btn${source === "service" ? " pinned" : ""}`} onClick={() => chooseSource("service")}>Dienst</button>
            <button className={`trk-icon-btn${source === "own" ? " pinned" : ""}`} onClick={() => chooseSource("own")}>Eigen setlist</button>
          </span>
        )}
        {data && data.dates.length > 0 && (
          <select className="input-field trk-date" value={date || ""} onChange={(e) => load(e.target.value)}>
            {data.dates.map(d => (
              <option key={d} value={d}>{formatDate(d)}{d === data.today ? " (vandaag)" : ""}</option>
            ))}
          </select>
        )}
        <button className="trk-icon-btn" onClick={() => load(date)} title="Vernieuwen"><RefreshCw size={14} /></button>
        {!desktop && (
          <button className="trk-load" onClick={loadIntoReaper} disabled={busy || !matched || playing} title="Alle gevonden songs openen als projecttabs in REAPER">
            <Download size={14} /> {busy ? "Bezig…" : "Klaarzetten in REAPER"}
          </button>
        )}
      </div>

      {data?.own && (
        <div className="trk-own-add">
          <select className="input-field" value="" onChange={e => { if (e.target.value) ownEdit(() => ownAdd(e.target.value)); }}>
            <option value="">+ Nummer toevoegen aan je eigen setlist…</option>
            {data.songs.filter(x => !ownPaths().includes(x.path)).map(x => (
              <option key={x.path} value={x.path}>{parseSongName(x.name).title}</option>
            ))}
          </select>
        </div>
      )}
      {data?.own && data.setlist.length === 0 && <p className="trk-empty">Je eigen setlist is leeg. Voeg hierboven nummers toe uit de map met nummers op deze computer.</p>}
      {data?.bridgeError && <p className="trk-warn"><AlertTriangle size={14} /> {data.bridgeError}</p>}
      {data && !data.date && !data.own && <p className="trk-empty">Er is nog geen dienst met een setlist in de Planner.</p>}
      {data?.date && !data.own && data.setlist.length === 0 && <p className="trk-empty">Deze dienst heeft nog geen liederen.</p>}

      <ol className="trk-songs">
        {data?.setlist.map((s, i) => {
          const name = s.path ? data.songs.find(x => x.path === s.path)?.name : undefined;
          const info = name ? parseSongName(name) : null;
          const isActive = !!s.path && s.path === activePath;
          const isOpen = !!s.path && openPaths.has(s.path);
          return (
            <li key={s.id} className={`trk-song-row${isActive ? " active" : ""}${!s.path ? " missing" : ""}`}>
              <button className="trk-song-main" onClick={() => selectSong(s)} disabled={!s.path || busy}>
                <span className="trk-song-nr">{i + 1}</span>
                <span className="trk-song-text">
                  <strong>{s.title}</strong>
                  <small>
                    {s.artist}
                    {info?.key && <> · {info.key} · {info.bpm} BPM</>}
                    {!s.path && !s.fetching && <> · geen track gevonden</>}
                    {!s.path && s.fetching && <> · <span style={{ color: "#fbbf24" }}>wordt opgehaald van de server…</span></>}
                    {s.path && s.local === "slim" && <> · <span style={{ color: "#fbbf24" }}>audio wordt opgehaald…</span></>}
                  </small>
                </span>
                {isActive ? <span className="trk-badge on">Actief</span>
                  : s.path && s.path === pendingSong ? <span className="trk-badge pending" title="Tik nogmaals om te annuleren">volgt…</span>
                  : isOpen ? <span className="trk-badge"><Check size={11} /> Klaar</span> : null}
              </button>
              {!stage && (
                <div className="trk-row-tools">
                {!(desktop && isOffline()) && (<>
                <button className="trk-icon-btn" onClick={() => setEditing(s)} disabled={!s.path} title="Tekst koppelen aan de secties van de track (FreeShow)">
                  <FileText size={14} /> Tekst
                </button>
                <button className="trk-icon-btn" onClick={() => setTiming(s)} disabled={!s.path} title="Timing van de FreeShow-dia's per sectie met de hand bijstellen">
                  <Timer size={14} /> Timing
                </button>
                </>)}
                {data.own ? (
                  <>
                    <button className="trk-icon-btn" onClick={() => ownEdit(() => ownMove(i, -1))} disabled={i === 0} aria-label="Omhoog"><ChevronUp size={14} /></button>
                    <button className="trk-icon-btn" onClick={() => ownEdit(() => ownMove(i, 1))} disabled={i === data.setlist.length - 1} aria-label="Omlaag"><ChevronDown size={14} /></button>
                    <button className="trk-icon-btn" onClick={() => ownEdit(() => ownRemove(i))} aria-label="Verwijder uit de setlist"><X size={14} /></button>
                  </>
                ) : (
                <select
                  className="input-field trk-link"
                  value={s.path || ""}
                  onChange={(e) => link(s, e.target.value)}
                  title={s.manual ? "Handmatig gekoppeld" : "Automatisch gevonden op titel"}
                >
                  <option value="">— geen track —</option>
                  {data.songs.map(song => (
                    <option key={song.path} value={song.path}>{parseSongName(song.name).title} ({song.name})</option>
                  ))}
                </select>
                )}
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {timing?.path && (
        <TimingEditor
          song={{ title: timing.title, artist: timing.artist, path: timing.path }}
          state={state}
          onClose={() => setTiming(null)}
          onError={onError}
          onStatus={onStatus}
        />
      )}

      {editing?.path && (
        <ArrangementEditor
          song={{ title: editing.title, artist: editing.artist, path: editing.path }}
          onClose={() => setEditing(null)}
          onError={onError}
          onStatus={onStatus}
        />
      )}
    </section>
  );
}
