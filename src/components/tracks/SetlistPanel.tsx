"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { ListOrdered, Download, RefreshCw, AlertTriangle, Check, FileText } from "lucide-react";
import type { ReaperState, BridgeSong } from "@/lib/reaperControl";
import { reaperAction } from "./useReaper";
import { parseSongName } from "./songName";
import ArrangementEditor from "./ArrangementEditor";

interface SetlistSong {
  id: string;
  title: string;
  artist: string;
  section: string;
  path: string | null;
  manual: boolean;
  local: "full" | "slim" | null;
}

interface SetlistData {
  today: string;
  dates: string[];
  date: string | null;
  setlist: SetlistSong[];
  songs: BridgeSong[];
  loaded: string[];
  bridgeError: string | null;
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

  useEffect(() => { load(null); }, [load]);

  const activePath = state?.bridge?.tabs.find(t => t.active)?.path;
  const openPaths = new Set(state?.bridge?.tabs.map(t => t.path) || []);
  const playing = state?.playState === 1;

  const selectSong = async (song: SetlistSong) => {
    if (!song.path || song.path === activePath) return;
    if (playing && !confirm(`"${song.title}" kiezen? De huidige song stopt.`)) return;
    setBusy(true);
    try {
      await reaperAction({ action: "song", path: song.path });
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
        {data && data.dates.length > 0 && (
          <select className="input-field trk-date" value={date || ""} onChange={(e) => load(e.target.value)}>
            {data.dates.map(d => (
              <option key={d} value={d}>{formatDate(d)}{d === data.today ? " (vandaag)" : ""}</option>
            ))}
          </select>
        )}
        <button className="trk-icon-btn" onClick={() => load(date)} title="Vernieuwen"><RefreshCw size={14} /></button>
        <button className="trk-load" onClick={loadIntoReaper} disabled={busy || !matched || playing} title="Alle gevonden songs openen als projecttabs in REAPER">
          <Download size={14} /> {busy ? "Bezig…" : "Klaarzetten in REAPER"}
        </button>
      </div>

      {data?.bridgeError && <p className="trk-warn"><AlertTriangle size={14} /> {data.bridgeError}</p>}
      {data && !data.date && <p className="trk-empty">Er is nog geen dienst met een setlist in de Planner.</p>}
      {data?.date && data.setlist.length === 0 && <p className="trk-empty">Deze dienst heeft nog geen liederen.</p>}

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
                    {!s.path && <> · geen track gevonden</>}
                    {s.path && s.local === "slim" && <> · <span style={{ color: "#fbbf24" }}>audio wordt opgehaald…</span></>}
                  </small>
                </span>
                {isActive ? <span className="trk-badge on">Actief</span> : isOpen ? <span className="trk-badge"><Check size={11} /> Klaar</span> : null}
              </button>
              {!stage && (
                <div className="trk-row-tools">
                <button className="trk-icon-btn" onClick={() => setEditing(s)} disabled={!s.path} title="Tekst koppelen aan de secties van de track (FreeShow)">
                  <FileText size={14} /> Tekst
                </button>
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
                </div>
              )}
            </li>
          );
        })}
      </ol>

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
