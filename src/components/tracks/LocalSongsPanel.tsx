"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Download, Trash2, Check, RefreshCw, AlertTriangle, Loader2 } from "lucide-react";
import {
  serverSongs, fetchJobs, startFetch, removeLocalSong, isFetching, sameSong, autoFetchEnabled, setAutoFetch, engineCall,
  type ServerSong, type FetchJob,
} from "@/lib/desktopEngine";

interface Props { onError: (m: string) => void; onStatus: (m: string) => void }

const fmtSize = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(1).replace(".", ",")} GB` : `${Math.round(b / 1e6)} MB`);

// The songs of the server library and which of them are on this computer. Fetching a song downloads
// its zip (resumable), unpacks it and makes the own click; it then shows up on the setlists by itself.
export default function LocalSongsPanel({ onError, onStatus }: Props) {
  const [songs, setSongs] = useState<ServerSong[] | null>(null);
  const [local, setLocal] = useState<{ name: string; path: string }[]>([]);
  const [jobs, setJobs] = useState<FetchJob[]>([]);
  const [auto, setAuto] = useState(() => autoFetchEnabled());

  const load = useCallback(async () => {
    try {
      setSongs(await serverSongs());
      setLocal((await engineCall("/library")).songs);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Laden mislukt");
    }
  }, [onError]);

  useEffect(() => {
    Promise.all([serverSongs(), engineCall("/library")])
      .then(([list, lib]) => { setSongs(list); setLocal(lib.songs); })
      .catch(err => onError(err instanceof Error ? err.message : "Laden mislukt"));
  }, [onError]);

  // while something is being fetched: follow it, and look again at what is on this computer when it is done
  useEffect(() => {
    let alive = true;
    let wasBusy = false;
    const tick = async () => {
      try {
        const j = await fetchJobs();
        if (!alive) return;
        setJobs(j);
        const busy = j.some(isFetching);
        if (wasBusy && !busy) { setLocal((await engineCall("/library")).songs); onStatus("Nummers staan klaar op deze computer."); }
        wasBusy = busy;
      } catch { /* not in the desktop app */ }
    };
    tick();
    const t = setInterval(tick, 1500);
    return () => { alive = false; clearInterval(t); };
  }, [onStatus]);

  const job = (s: ServerSong) => jobs.find(j => j.id === s.id);
  const onThisComputer = (s: ServerSong) => local.some(l => sameSong(s.title, l.name.split("-")[0].trim()) || sameSong(s.title, l.name));

  const remove = async (s: ServerSong) => {
    const entry = local.find(l => sameSong(s.title, l.name.split("-")[0].trim()) || sameSong(s.title, l.name));
    if (!entry) return;
    if (!confirm(`"${s.title}" van deze computer halen? Het gaat naar de Prullenbak en kan altijd opnieuw van de server worden opgehaald.`)) return;
    const folder = entry.path.replace(/\/[^/]*$/, "").split("/").slice(-1)[0];
    const r = await removeLocalSong(folder);
    if (!r.ok) onError("Verwijderen mislukt"); else { onStatus("Naar de Prullenbak verplaatst."); setTimeout(load, 1500); }
  };

  return (
    <section className="glass-card trk-local">
      <div className="trk-setlist-head">
        <h3 className="trk-title"><Download size={18} style={{ color: "var(--primary)" }} /> Nummers op deze computer</h3>
        <label className="trk-meta" style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" checked={auto} onChange={e => { setAuto(e.target.checked); setAutoFetch(e.target.checked); }} />
          Nummers van de setlist automatisch ophalen
        </label>
        <button className="trk-icon-btn" onClick={load} title="Vernieuwen"><RefreshCw size={14} /></button>
      </div>
      <p className="trk-arr-hint">Het ophalen kan even duren (ongeveer 1 GB per nummer). Een onderbroken download gaat verder waar hij was.</p>
      {!songs && <p className="trk-empty">Laden…</p>}
      {songs && songs.length === 0 && <p className="trk-empty">De server heeft nog geen nummers in de bibliotheek.</p>}
      <ul className="trk-songs">
        {songs?.map(s => {
          const j = job(s);
          const here = onThisComputer(s);
          return (
            <li key={s.id} className={`trk-song-row${here ? " active" : ""}`}>
              <div className="trk-song-main" style={{ cursor: "default" }}>
                <span className="trk-song-text">
                  <strong>{s.title}</strong>
                  <small>{s.key && <>{s.key} · {s.bpm} BPM · </>}{fmtSize(s.size)}{s.own && " · eigen opname"}</small>
                </span>
                {j && isFetching(j) ? (
                  <span className="trk-badge pending"><Loader2 size={11} className="prc-spin" /> {j.state === "ophalen" ? `ophalen ${Math.round(j.progress * 100)}%` : j.state}</span>
                ) : j?.state === "fout" ? (
                  <span className="trk-warn" title={j.message}><AlertTriangle size={13} /> {j.message || "mislukt"}</span>
                ) : here ? <span className="trk-badge"><Check size={11} /> Op deze computer</span> : null}
              </div>
              <div className="trk-row-tools">
                {!here && !(j && isFetching(j)) && (
                  <button className="trk-load" onClick={() => startFetch(s)}><Download size={14} /> {j?.state === "fout" ? "Opnieuw" : "Ophalen"}</button>
                )}
                {here && <button className="trk-icon-btn" onClick={() => remove(s)} title="Van deze computer halen (Prullenbak)"><Trash2 size={14} /></button>}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
