"use client";

import React, { useState, useRef } from "react";
import { Waves, Square, Music } from "lucide-react";
import type { ReaperState } from "@/lib/reaperControl";
import { reaperAction } from "./useReaper";
import { parseSongName } from "./songName";

interface PadsPanelProps {
  state: ReaperState | null;
  onError: (message: string) => void;
  stage?: boolean;
}

const KEYS = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
// Song keys as MultiTracks writes them -> the pad file names
const ENHARMONIC: Record<string, string> = { "C#": "Db", "D#": "Eb", "F#": "Gb", "G#": "Ab", "A#": "Bb", Cb: "B", Fb: "E", "E#": "F", "B#": "C" };
const FADE = 4;

function padKeyFor(songKey?: string): string | null {
  if (!songKey) return null;
  const root = songKey.replace(/m$/, "");
  const key = ENHARMONIC[root] || root;
  return KEYS.includes(key) ? key : null;
}

// Ambient pads per key, played by the pad player on the track computer
// (keeps sounding through song changes); switching keys crossfades.
export default function PadsPanel({ state, onError, stage }: PadsPanelProps) {
  const pads = state?.pads;
  const sets = pads?.sets || {};
  const setNames = Object.keys(sets);
  const [chosenSet, setSet] = useState<string | null>(null);
  const [chosenLayer, setLayer] = useState<string | null>(null);
  const [volume, setVolume] = useState<number | null>(null);
  const volumeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Own choice first, then what's playing, then the first available
  const set = chosenSet && sets[chosenSet] ? chosenSet : (pads?.playing && sets[pads.set] ? pads.set : setNames[0] || "");
  const layers = sets[set] || [];
  const layer = chosenLayer && layers.includes(chosenLayer)
    ? chosenLayer
    : pads?.playing && layers.includes(pads.layer) ? pads.layer : layers.includes("Full Mix") ? "Full Mix" : layers[0] || "";

  const run = async (value: object) => {
    try {
      await reaperAction({ action: "pad", value });
    } catch (err) {
      onError(err instanceof Error ? err.message : "Pad-actie mislukt");
    }
  };

  const play = (key: string, withLayer = layer) => run({ op: "play", set, layer: withLayer, key, fade: FADE });

  const activeTab = state?.bridge?.tabs.find(t => t.active);
  const songKey = padKeyFor(activeTab ? parseSongName(activeTab.name).key : undefined);
  const shownVolume = volume ?? pads?.volume ?? 0.8;

  const changeVolume = (v: number) => {
    setVolume(v);
    clearTimeout(volumeTimer.current);
    volumeTimer.current = setTimeout(() => {
      run({ op: "volume", volume: v });
      setTimeout(() => setVolume(null), 1500);
    }, 150);
  };

  if (!pads) {
    return (
      <section className={`glass-card trk-pads${stage ? " stage" : ""}`}>
        <h3 className="trk-title"><Waves size={18} style={{ color: "#a855f7" }} /> Pads</h3>
        <p className="trk-empty" style={{ marginTop: 8 }}>De padspeler draait niet op de track-computer (ArkPads).</p>
      </section>
    );
  }

  return (
    <section className={`glass-card trk-pads${stage ? " stage" : ""}`}>
      <div className="trk-setlist-head">
        <h3 className="trk-title"><Waves size={18} style={{ color: "#a855f7" }} /> Pads</h3>
        {setNames.length > 1 && (
          <select className="input-field trk-date" value={set} onChange={e => setSet(e.target.value)}>
            {setNames.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
        <div className="trk-modes" role="radiogroup" aria-label="Klank">
          {layers.map(l => (
            <button key={l} role="radio" aria-checked={layer === l} className={`trk-mode${layer === l ? " on" : ""}`}
              onClick={() => { setLayer(l); if (pads.playing && pads.key) play(pads.key, l); }}>
              {l}
            </button>
          ))}
        </div>
      </div>

      <div className="trk-pad-keys">
        {KEYS.map(k => (
          <button key={k} className={`trk-pad-key${pads.playing && pads.key === k ? " on" : ""}${songKey === k ? " song" : ""}`}
            onClick={() => (pads.playing && pads.key === k && pads.layer === layer ? run({ op: "stop", fade: FADE }) : play(k))}
            title={pads.playing && pads.key === k ? "Tik om uit te faden" : `Pad in ${k}`}>
            {k.replace("b", "♭")}
          </button>
        ))}
      </div>

      <div className="trk-pad-row">
        <button className="trk-load" onClick={() => songKey && play(songKey)} disabled={!songKey}
          title={songKey ? `Toonsoort van de huidige song: ${songKey}` : "Toonsoort van de song onbekend"}>
          <Music size={14} /> Toonsoort song{songKey ? `: ${songKey.replace("b", "♭")}` : ""}
        </button>
        <button className="trk-save" onClick={() => run({ op: "stop", fade: FADE })} disabled={!pads.playing}>
          <Square size={13} /> Uitfaden
        </button>
        <label className="trk-pad-volume">
          <span className="trk-label">Volume</span>
          <input type="range" min={0} max={1} step={0.01} value={shownVolume}
            onChange={e => changeVolume(parseFloat(e.target.value))} aria-label="Padvolume" />
        </label>
      </div>
      {pads.error && <p className="trk-warn" style={{ marginTop: 8 }}>{pads.error}</p>}
    </section>
  );
}
