"use client";

import React, { useRef, useState } from "react";
import { Play, Pause, Square, SkipBack, Save, Volume2, VolumeX } from "lucide-react";
import type { ReaperState } from "@/lib/reaperControl";
import { reaperAction, formatTime } from "./useReaper";
import { parseSongName } from "./songName";
import { dbToFader, UNITY, volumeToFader, faderToVolume, formatDb } from "./faderLaw";

// Master volume: up to +6 dB (the X32 fader law, so the position means the same as on the desk)
const MASTER_MAX = dbToFader(6);
const MASTER_SEND_MS = 120;

interface TransportBarProps {
  state: ReaperState | null;
  onError: (message: string) => void;
  onSaved?: () => void;
  showSave?: boolean;
  stage?: boolean;
}

export default function TransportBar({ state, onError, onSaved, showSave, stage }: TransportBarProps) {
  const playState = state?.playState || 0;
  const position = state?.position || 0;
  const regions = state?.regions || [];
  const current = regions.find(r => position >= r.start && position < r.end);
  const activeTab = state?.bridge?.tabs.find(t => t.active);
  const song = activeTab ? parseSongName(activeTab.name) : null;
  // Set up automatically when this song ends
  const nextPath = state?.bridge?.nextSong;
  const next = nextPath ? parseSongName((nextPath.split("/").pop() || "").replace(/\.rpp$/i, "")) : null;

  // Master volume and mute for all busses together; the local value stays while dragging so the
  // slider doesn't jump back to an older value from the state stream
  const masterVol = state?.bridge?.master ?? 1;
  const masterMuted = !!state?.bridge?.masterMute;
  const [localMaster, setLocalMaster] = useState<number | null>(null);
  const lastSend = useRef(0);
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
  const masterFader = localMaster ?? Math.min(MASTER_MAX, volumeToFader(masterVol));
  const sendMaster = async (body: object) => {
    try { await reaperAction({ action: "master", ...body }); } catch (err) { onError(err instanceof Error ? err.message : "Master wijzigen mislukt"); }
  };
  const moveMaster = (f: number, final: boolean) => {
    setLocalMaster(f);
    const now = Date.now();
    if (final || now - lastSend.current >= MASTER_SEND_MS) {
      lastSend.current = now;
      sendMaster({ value: faderToVolume(f) });
    }
    if (hold.current) clearTimeout(hold.current);
    if (final) hold.current = setTimeout(() => setLocalMaster(null), 800);
  };

  const run = async (action: string) => {
    try {
      await reaperAction({ action });
      return true;
    } catch (err) {
      onError(err instanceof Error ? err.message : "Actie mislukt");
      return false;
    }
  };

  const save = async () => {
    if (!confirm("De huidige mix (volumes, mutes) opslaan in dit REAPER-project?")) return;
    if (await run("save")) onSaved?.();
  };

  return (
    <section className={`glass-card trk-transport${stage ? " stage" : ""}`}>
      <div className="trk-song">
        <span className="trk-label">Song</span>
        <strong>{song?.title || "—"}</strong>
        {song?.key && <span className="trk-meta">{song.key} · {song.bpm} BPM</span>}
        {next && <span className="trk-meta" title="Staat klaar zodra dit nummer uit is">Hierna: {next.title}</span>}
      </div>
      <div className="trk-transport-buttons">
        <button className="trk-t-btn" onClick={() => run("start")} title="Naar begin"><SkipBack size={stage ? 26 : 20} /></button>
        <button className={`trk-t-btn play${playState === 1 ? " active" : ""}`} onClick={() => run("play")} title="Afspelen"><Play size={stage ? 30 : 22} /></button>
        <button className={`trk-t-btn${playState === 2 ? " active" : ""}`} onClick={() => run("pause")} title="Pauze"><Pause size={stage ? 26 : 20} /></button>
        <button className="trk-t-btn stop" onClick={() => run("stop")} title="Stop"><Square size={stage ? 24 : 18} /></button>
      </div>
      <div className="trk-clock">
        <span className="trk-time">{formatTime(position)}</span>
        <span className="trk-meta">Maat {state?.positionBeats || "-"}</span>
      </div>
      <div className="trk-current">
        <span className="trk-label">Sectie</span>
        <strong>{current?.name || "—"}</strong>
      </div>
      <div className={`trk-master${masterMuted ? " muted" : ""}`} title="Master: alle bussen samen (dubbelklik op de schuif = 0 dB)">
        <span className="trk-label">Master</span>
        <button className={`trk-icon-btn${masterMuted ? " pinned" : ""}`} onClick={() => sendMaster({ mute: !masterMuted })} aria-label={masterMuted ? "Master aan" : "Master dempen"}>
          {masterMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
        </button>
        <input
          className="trk-master-slider"
          type="range" min={0} max={MASTER_MAX} step={0.002}
          value={masterFader}
          onChange={e => moveMaster(parseFloat(e.target.value), false)}
          onPointerUp={e => moveMaster(parseFloat((e.target as HTMLInputElement).value), true)}
          onKeyUp={e => moveMaster(parseFloat((e.target as HTMLInputElement).value), true)}
          onDoubleClick={() => moveMaster(UNITY, true)}
          aria-label="Master volume"
        />
        <span className="trk-meta trk-master-db">{formatDb(masterFader)} dB</span>
      </div>
      {showSave && (
        <button className="trk-save" onClick={save} title="Mix opslaan in het REAPER-project">
          <Save size={14} /> Opslaan
        </button>
      )}
    </section>
  );
}
