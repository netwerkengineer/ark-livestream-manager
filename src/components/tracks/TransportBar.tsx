"use client";

import React from "react";
import { Play, Pause, Square, SkipBack, Save } from "lucide-react";
import type { ReaperState } from "@/lib/reaperControl";
import { reaperAction, formatTime } from "./useReaper";
import { parseSongName } from "./songName";

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
      {showSave && (
        <button className="trk-save" onClick={save} title="Mix opslaan in het REAPER-project">
          <Save size={14} /> Opslaan
        </button>
      )}
    </section>
  );
}
