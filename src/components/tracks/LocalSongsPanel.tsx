"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Download, Trash2, Check, RefreshCw, AlertTriangle, Loader2, FileArchive } from "lucide-react";
import { parseSongName } from "./songName";
import {
  serverSongs, fetchJobs, startFetch, startImport, removeLocalSong, isFetching, sameSong, autoFetchEnabled, setAutoFetch, engineCall, isOffline,
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
  const [offline] = useState(() => isOffline());

  const load = useCallback(async () => {
    try {
      setSongs(isOffline() ? [] : await serverSongs());
      setLocal((await engineCall("/library")).songs);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Laden mislukt");
    }
  }, [onError]);

  useEffect(() => {
    // without a connection to the server there is only what is on this computer
    Promise.all([isOffline() ? Promise.resolve([] as ServerSong[]) : serverSongs(), engineCall("/library")])
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

  const matches = (s: ServerSong, l: { name: string }) => sameSong(s.title, l.name.split("-")[0].trim()) || sameSong(s.title, l.name);
  const job = (s: ServerSong) => jobs.find(j => j.id === s.id);
  const onThisComputer = (s: ServerSong) => local.some(l => matches(s, l));

  const remove = async (s: ServerSong) => {
    const entry = local.find(l => sameSong(s.title, l.name.split("-")[0].trim()) || sameSong(s.title, l.name));
    if (!entry) return;
    if (!confirm(`"${s.title}" van deze computer halen? Het gaat naar de Prullenbak en kan altijd opnieuw van de server worden opgehaald.`)) return;
    const folder = entry.path.replace(/\/[^/]*$/, "").split("/").slice(-1)[0];
    const r = await removeLocalSong(folder);
    if (!r.ok) onError("Verwijderen mislukt"); else { onStatus("Naar de Prullenbak verplaatst."); setTimeout(load, 1500); }
  };

  const localOnly = local.filter(l => !(songs || []).some(s => matches(s, l)));
  const imports = jobs.filter(j => j.id.startsWith("lokaal-") && (isFetching(j) || j.state === "fout"));
  const folderOf = (path: string) => path.replace(/\/[^/]*$/, "").split("/").slice(-1)[0];
  const removeOnly = async (l: { name: string; path: string }) => {
    const title = parseSongName(l.name).title;
    if (!confirm(`"${title}" van deze computer halen? Het gaat naar de Prullenbak. Dit nummer staat niet op de server: je moet het dan opnieuw importeren.`)) return;
    const r = await removeLocalSong(folderOf(l.path));
    if (!r.ok) onError("Verwijderen mislukt"); else { onStatus("Naar de Prullenbak verplaatst."); setTimeout(load, 1500); }
  };

  return (
    <section className="glass-card trk-local">
      <div className="trk-setlist-head">
        <h3 className="trk-title"><Download size={18} style={{ color: "var(--primary)" }} /> Nummers op deze computer</h3>
        {!offline && (
          <label className="trk-meta" style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={auto} onChange={e => { setAuto(e.target.checked); setAutoFetch(e.target.checked); }} />
            Nummers van de setlist automatisch ophalen
          </label>
        )}
        <button className="trk-load" onClick={startImport} title="Een MultiTracks-zip of eigen opname (zip met song.json) direct op deze computer zetten, zonder server"><FileArchive size={14} /> Importeer zip…</button>
        <button className="trk-icon-btn" onClick={load} title="Vernieuwen"><RefreshCw size={14} /></button>
      </div>
      <p className="trk-arr-hint">{offline
        ? "Zonder server: je kunt hier een zip importeren. Nummers van de server ophalen kan weer als je verbonden bent."
        : "Het ophalen kan even duren (ongeveer 1 GB per nummer). Een onderbroken download gaat verder waar hij was. Een nummer dat nog niet op de server staat kun je ook direct importeren (zip)."}</p>
      {imports.map(j => (
        <p key={j.id} className={j.state === "fout" ? "trk-warn" : "trk-meta"} style={{ margin: "6px 0" }}>
          {j.state === "fout" ? <AlertTriangle size={13} /> : <Loader2 size={12} className="prc-spin" />} {j.title}: {j.state === "fout" ? j.message || "mislukt" : j.state}
        </p>
      ))}
      {!offline && !songs && <p className="trk-empty">Laden…</p>}
      {!offline && songs && songs.length === 0 && <p className="trk-empty">De server heeft nog geen nummers in de bibliotheek.</p>}
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
      {localOnly.length > 0 && (
        <>
          <h4 className="trk-label" style={{ margin: "14px 0 6px" }}>{offline ? "Op deze computer" : "Alleen op deze computer"}</h4>
          <ul className="trk-songs">
            {localOnly.map(l => (
              <li key={l.path} className="trk-song-row active">
                <div className="trk-song-main" style={{ cursor: "default" }}>
                  <span className="trk-song-text">
                    <strong>{parseSongName(l.name).title}</strong>
                    <small>{[parseSongName(l.name).key, parseSongName(l.name).bpm && `${parseSongName(l.name).bpm} BPM`].filter(Boolean).join(" · ")}</small>
                  </span>
                  <span className="trk-badge"><Check size={11} /> Op deze computer</span>
                </div>
                <div className="trk-row-tools">
                  <button className="trk-icon-btn" onClick={() => removeOnly(l)} title="Van deze computer halen (Prullenbak)"><Trash2 size={14} /></button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
