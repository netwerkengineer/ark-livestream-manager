"use client";

import React, { useRef, useState } from "react";
import { Play, Pause, Square, SkipBack, Save, Volume2, VolumeX, TrendingDown, Metronome, Disc3 } from "lucide-react";
import type { ReaperState } from "@/lib/reaperControl";
import { reaperAction, formatTime } from "./useReaper";
import { parseSongName } from "./songName";
import { hasDesktopEngine, COUNT_IN_KEY } from "@/lib/desktopEngine";
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

  // Fade out: only in the app's own player; after the chosen number of seconds the song is silent and stops
  const [fadeSecs, setFadeSecs] = useState(() => {
    try { const v = Number(localStorage.getItem("ark.fadeSecs")); return [4, 8, 12, 16].includes(v) ? v : 8; } catch { return 8; }
  });
  const [countBars, setCountBars] = useState(() => {
    try { const v = Number(localStorage.getItem(COUNT_IN_KEY)); return [1, 2].includes(v) ? v : 0; } catch { return 0; }
  });
  const countBeat = state?.bridge?.countBeat || 0;
  const countBeats = state?.bridge?.countBeats || 0;
  const clickDiv = state?.bridge?.clickDiv ?? 0;
  const clickAccent = state?.bridge?.clickAccent ?? true;
  const clickDb = Math.round(state?.bridge?.clickDb ?? -6);
  const setClick = async (body: object) => {
    try { await reaperAction({ action: "click", ...body }); } catch (err) { onError(err instanceof Error ? err.message : "Click wijzigen mislukt"); }
  };
  const ref = state?.bridge?.reference;
  const sendRef = async (body: object) => {
    try { await reaperAction({ action: "reference", ...body }); } catch (err) { onError(err instanceof Error ? err.message : "Referentie mislukt"); }
  };
  // The reference is a file of the original recording; the app (desktop) lets you pick it and keeps a copy with the song
  const pickReference = async () => {
    const pick = (window as { arkDesktop?: { pickAudio?: () => Promise<{ path: string }> } }).arkDesktop?.pickAudio;
    if (!pick) { onError("Een referentie kiezen kan alleen in de desktop-app."); return; }
    try {
      const { path } = await pick();
      if (path) await reaperAction({ action: "referenceLoad", path });
    } catch (err) { onError(err instanceof Error ? err.message : "Referentie kiezen mislukt"); }
  };
  const fading = !!state?.bridge?.fading;
  const canFade = hasDesktopEngine();
  const fadeOut = async () => {
    try { await reaperAction({ action: "fadeout", value: fadeSecs }); } catch (err) { onError(err instanceof Error ? err.message : "Uitfaden mislukt"); }
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
        {canFade && (
          <span className="trk-fade">
            {ref && (ref.available ? (
              <>
                <button className={`trk-icon-btn${ref.on ? " pinned" : ""}`} onClick={() => sendRef({ on: !ref.on })} aria-pressed={ref.on}
                  title={ref.on ? `Je hoort de referentie (${ref.file}); tik om terug te gaan naar de stems` : `Vergelijk met de originele opname (${ref.file}); click en guide blijven klinken`}>
                  <Disc3 size={stage ? 18 : 14} /> {ref.on ? "Referentie aan" : "Referentie"}
                </button>
                {ref.on && (
                  <>
                    {[-1, -0.1, 0.1, 1].map(v => (
                      <button key={v} className="trk-icon-btn" onClick={() => sendRef({ nudge: v })} title="Verschuif de referentie zodat hij gelijk loopt met de stems">{v > 0 ? "+" : "−"}{Math.abs(v)}</button>
                    ))}
                    <span className="trk-meta" title="Waar 0:00 van het nummer in de referentie ligt">{ref.offset.toFixed(2)} s</span>
                  </>
                )}
                <button className="trk-icon-btn" onClick={pickReference} title="Een ander referentiebestand kiezen (het vorige blijft bewaard)">…</button>
              </>
            ) : (
              <button className="trk-icon-btn" onClick={pickReference} title="Kies de originele opname (mp3, m4a, wav, flac) om mee te vergelijken"><Disc3 size={stage ? 18 : 14} /> Referentie kiezen…</button>
            ))}
            <Metronome size={stage ? 20 : 16} className={clickDiv ? "trk-click-on" : "trk-click-off"} aria-hidden />
            <select className="trk-fade-secs" value={clickDiv} aria-label="Click" title="Eigen click: loopt mee met de maten van het nummer"
              onChange={e => setClick({ div: Number(e.target.value) })}>
              <option value={0}>Click uit</option>
              <option value={1}>Click ¼</option>
              <option value={2}>Click ⅛</option>
              <option value={3}>Click ⅛ triool</option>
              <option value={4}>Click 1/16</option>
            </select>
            {clickDiv > 0 && (
              <>
                <button className={`trk-icon-btn${clickAccent ? " pinned" : ""}`} onClick={() => setClick({ accent: !clickAccent })} title="Accent: de één van elke maat hoger en harder" aria-pressed={clickAccent}>Accent</button>
                <select className="trk-fade-secs" value={clickDb} aria-label="Sterkte van de click" onChange={e => setClick({ db: Number(e.target.value) })}>
                  {[-24, -18, -12, -6, 0].map(v => <option key={v} value={v}>{v} dB</option>)}
                </select>
              </>
            )}
            <select className="trk-fade-secs" value={countBars} aria-label="Voorteller" title="Voorteller: click vooraf, alleen als het nummer vanaf het begin start"
              onChange={e => { const v = Number(e.target.value); setCountBars(v); try { localStorage.setItem(COUNT_IN_KEY, String(v)); } catch { /* optional */ } }}>
              <option value={0}>Voorteller uit</option>
              <option value={1}>1 maat voor</option>
              <option value={2}>2 maten voor</option>
            </select>
            <button className={`trk-t-btn${fading ? " active" : ""}`} onClick={fadeOut} disabled={playState !== 1 || fading} title={`Uitfaden in ${fadeSecs} seconden en dan stoppen`}><TrendingDown size={stage ? 26 : 20} /></button>
            <select className="trk-fade-secs" value={fadeSecs} aria-label="Duur van het uitfaden"
              onChange={e => { const v = Number(e.target.value); setFadeSecs(v); try { localStorage.setItem("ark.fadeSecs", String(v)); } catch { /* optional */ } }}>
              {[4, 8, 12, 16].map(v => <option key={v} value={v}>{v} s</option>)}
            </select>
          </span>
        )}
      </div>
      <div className="trk-clock">
        <span className="trk-time">{countBeat > 0 ? `${countBeat}/${countBeats}` : formatTime(position)}</span>
        <span className="trk-meta">{countBeat > 0 ? "Voorteller" : `Maat ${state?.positionBeats || "-"}`}</span>
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
