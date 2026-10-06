"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { useDropzone } from "react-dropzone";
import { Library, UploadCloud, RotateCcw, Trash2, CheckCircle2, AlertTriangle, Loader2, Server, ChevronDown, ChevronUp, Pin, HardDrive, Cloud, Music2 } from "lucide-react";
import type { TrackItem, AgentInfo } from "@/lib/trackLibrary";
import { reaperAction } from "./useReaper";
import { parseSongName } from "./songName";
import OwnRecordingWizard from "./OwnRecordingWizard";

interface TrackLibraryPanelProps {
  onError: (message: string) => void;
  onStatus: (message: string) => void;
}

type LibraryItem = TrackItem & { received?: number; needed?: boolean };

const STATUS_LABEL: Record<string, string> = {
  uploading: "Uploaden onderbroken",
  stored: "Wacht op Mac",
  downloading: "Naar Mac",
  converting: "Omzetten",
  ready: "Klaar",
  error: "Mislukt",
};

const AGENT_ONLINE_MS = 30_000;
const MIN_CHUNK = 512 * 1024;

function mb(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
}

async function putChunk(id: string, offset: number, blob: Blob): Promise<Response> {
  return fetch(`/api/tracks/upload/${id}?offset=${offset}`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: blob,
  });
}

export default function TrackLibraryPanel({ onError, onStatus }: TrackLibraryPanelProps) {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [agent, setAgent] = useState<AgentInfo | null>(null);
  const [upload, setUpload] = useState<{ name: string; sent: number; size: number } | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [wizard, setWizard] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const onErrorRef = useRef(onError);
  useEffect(() => { onErrorRef.current = onError; });

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/tracks/library", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
      setItems(data.items);
      setAgent(data.agent);
      setNow(Date.now());
    } catch (err) {
      onErrorRef.current(err instanceof Error ? err.message : "Bibliotheek laden mislukt");
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, [load]);

  const startUpload = async (file: File) => {
    if (upload) return;
    setUpload({ name: file.name, sent: 0, size: file.size });
    try {
      // Same file again after an interrupted upload: carry on where it stopped
      const resumable = items.find(i => i.status === "uploading" && i.fileName === file.name && i.size === file.size);
      let id: string;
      let chunk: number;
      let offset = 0;
      if (resumable) {
        id = resumable.id;
        const res = await fetch(`/api/tracks/upload/${id}`, { cache: "no-store" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        offset = data.received;
        chunk = 8 * 1024 * 1024;
      } else {
        const res = await fetch("/api/tracks/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileName: file.name, size: file.size }),
        });
        const data = await res.json();
        if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
        id = data.id;
        chunk = data.chunkSize;
      }

      let failures = 0;
      while (offset < file.size) {
        setUpload({ name: file.name, sent: offset, size: file.size });
        let res: Response;
        try {
          res = await putChunk(id, offset, file.slice(offset, offset + chunk));
        } catch {
          if (++failures > 5) throw new Error("Verbinding verbroken tijdens uploaden. Kies het bestand opnieuw om verder te gaan.");
          await new Promise(r => setTimeout(r, 2000 * failures));
          continue;
        }
        if (res.status === 413 && chunk > MIN_CHUNK) {
          chunk = Math.max(MIN_CHUNK, Math.floor(chunk / 2)); // proxy accepts smaller pieces only
          continue;
        }
        const data = await res.json().catch(() => ({}));
        if (res.status === 409 && typeof data.received === "number") {
          offset = data.received;
          continue;
        }
        if (!res.ok) {
          if (++failures > 5) throw new Error(data.error || `Uploaden mislukt (HTTP ${res.status})`);
          await new Promise(r => setTimeout(r, 2000 * failures));
          continue;
        }
        failures = 0;
        offset = data.received;
      }

      await reaperAction({}, `/api/tracks/upload/${id}?complete=1`);
      onStatus(`"${file.name}" staat op de server; de track-computer haalt hem op.`);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Uploaden mislukt");
    } finally {
      setUpload(null);
      load();
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { "application/zip": [".zip"] },
    multiple: false,
    disabled: !!upload,
    onDrop: files => { if (files[0]) startUpload(files[0]); },
    onDropRejected: () => onError("Kies het .zip-bestand zoals je het van MultiTracks downloadt."),
  });

  const act = async (action: "retry" | "delete" | "pin", item: LibraryItem) => {
    if (action === "delete" && !confirm(`"${item.fileName}" verwijderen? Ook de kopie op de track-computer gaat naar de prullenbak (~/Tracks/_trash).`)) return;
    try {
      await reaperAction({ action, id: item.id, value: action === "pin" ? !item.pinned : undefined }, "/api/tracks/library");
      load();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Actie mislukt");
    }
  };

  const agentOnline = !!agent && now - new Date(agent.lastSeen).getTime() < AGENT_ONLINE_MS;

  return (
    <section className="glass-card trk-library">
      <div className="trk-setlist-head">
        <h3 className="trk-title"><Library size={18} style={{ color: "#a855f7" }} /> Track-bibliotheek</h3>
        <span className={`trk-conn${agentOnline ? "" : " off"}`} title={agent ? `Laatst gezien ${new Date(agent.lastSeen).toLocaleString("nl-NL")}` : "Agent nog nooit verbonden"}>
          <Server size={11} style={{ verticalAlign: "-1px" }} /> Track-computer {agentOnline ? `online${agent?.host ? ` (${agent.host})` : ""}` : "offline"}
        </span>
      </div>

      <div {...getRootProps({ className: `trk-drop${isDragActive ? " active" : ""}${upload ? " busy" : ""}` })}>
        <input {...getInputProps()} />
        {upload ? (
          <>
            <span className="trk-drop-title"><Loader2 size={16} className="trk-spin" /> {upload.name}</span>
            <div className="trk-progress"><div style={{ width: `${(upload.sent / upload.size) * 100}%` }} /></div>
            <small>{mb(upload.sent)} van {mb(upload.size)} · laat dit venster open</small>
          </>
        ) : (
          <>
            <span className="trk-drop-title"><UploadCloud size={18} /> Sleep een MultiTracks-zip hierheen of klik om te kiezen</span>
            <small>De zip zoals je hem van MultiTracks.com downloadt. Hij wordt bewaard op de server en automatisch klaargezet op de track-computer.</small>
          </>
        )}
      </div>

      {wizard ? (
        <OwnRecordingWizard
          onClose={() => setWizard(false)}
          onError={onError}
          onDone={title => { onStatus(`"${title}" staat op de server; de oefenversie wordt gemaakt en de track-computer haalt hem op.`); load(); }}
        />
      ) : (
        <button className="own-open" onClick={() => setWizard(true)} disabled={!!upload}>
          <Music2 size={15} /> Eigen opname toevoegen <small>(zelf opgenomen stems, zonder MultiTracks-zip)</small>
        </button>
      )}

      <p className="trk-arr-hint">
        Op de Mac mini staat alleen de audio van songs op komende setlists, songs van de laatste weken en songs met <Pin size={11} /> (altijd houden).
        Van de rest blijft het REAPER-project staan (mix, dia-blokken); de audio komt vanzelf terug zodra de song weer op een setlist staat.
      </p>
      {items.length === 0 && <p className="trk-empty">Nog geen tracks geüpload.</p>}
      <ul className="trk-lib-list">
        {items.map(item => {
          const song = parseSongName(item.fileName.replace(/\.zip$/i, ""));
          const busy = item.status === "stored" || item.status === "downloading" || item.status === "converting";
          const open = expanded === item.id;
          return (
            <li key={item.id} className={`trk-lib-item ${item.status}`}>
              <div className="trk-lib-row">
                <span className="trk-lib-icon">
                  {item.status === "ready" ? <CheckCircle2 size={18} color="#4ade80" />
                    : item.status === "error" || item.status === "uploading" ? <AlertTriangle size={18} color="#f87171" />
                    : <Loader2 size={18} className="trk-spin" color="var(--primary)" />}
                </span>
                <span className="trk-song-text">
                  <strong>{song.title}</strong>
                  <small>
                    {song.key && <>{song.key} · {song.bpm} BPM · </>}
                    {mb(item.size)} · {item.uploadedBy} · {new Date(item.uploadedAt).toLocaleDateString("nl-NL")}
                  </small>
                  <small className="trk-lib-msg">
                    {STATUS_LABEL[item.status]}{item.message ? ` – ${item.message}` : ""}
                    {item.status === "uploading" && item.received !== undefined && (item.own ? ` (${mb(item.received)} ontvangen; maak dezelfde opname opnieuw om verder te gaan)` : ` (${mb(item.received)} ontvangen; kies hetzelfde bestand opnieuw om verder te gaan)`)}
                  </small>
                </span>
                {item.status === "ready" && (
                  <span className={`trk-badge${item.local === "slim" ? "" : " local"}`} title={
                    item.local === "slim"
                      ? (item.needed ? "Nodig: de audio wordt nu opgehaald" : "Alleen op de server; komt terug zodra het op een setlist staat")
                      : "Audio staat op de track-computer"}>
                    {item.local === "slim" ? <><Cloud size={11} /> {item.needed ? "wordt opgehaald" : "alleen server"}</> : <><HardDrive size={11} /> op Mac mini</>}
                  </span>
                )}
                {item.status === "ready" && (
                  <button className={`trk-icon-btn${item.pinned ? " pinned" : ""}`} onClick={() => act("pin", item)}
                    title={item.pinned ? "Altijd houden staat aan: tik om uit te zetten" : "Altijd op de Mac mini houden (ook als het niet op een setlist staat)"}>
                    <Pin size={14} />
                  </button>
                )}
                {item.report?.sections && (
                  <button className="trk-icon-btn" onClick={() => setExpanded(open ? null : item.id)} title="Details">
                    {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>
                )}
                {item.status === "error" && (
                  <button className="trk-icon-btn" onClick={() => act("retry", item)} title="Opnieuw proberen"><RotateCcw size={14} /></button>
                )}
                {!busy && (
                  <button className="trk-icon-btn" onClick={() => act("delete", item)} title="Verwijderen"><Trash2 size={14} /></button>
                )}
              </div>
              {open && item.report && (
                <div className="trk-lib-details">
                  <p><strong>Secties:</strong> {item.report.sections?.join(" · ")}</p>
                  {item.report.busses && Object.entries(item.report.busses).map(([bus, stems]) => (
                    <p key={bus}><strong>{bus}:</strong> {stems.length ? stems.join(", ") : "–"}</p>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
