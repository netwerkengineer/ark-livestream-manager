"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import {
  SlidersHorizontal,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Music,
  MonitorSmartphone,
  Radio,
  Library
} from "lucide-react";
import type { ReaperTrack } from "@/lib/reaperControl";
import { useReaperState } from "@/components/tracks/useReaper";
import TransportBar from "@/components/tracks/TransportBar";
import SetlistPanel from "@/components/tracks/SetlistPanel";
import SectionsPanel from "@/components/tracks/SectionsPanel";
import TrackLibraryPanel from "@/components/tracks/TrackLibraryPanel";
import TimingRecorder from "@/components/tracks/TimingRecorder";
import PadsPanel from "@/components/tracks/PadsPanel";
import Fader from "@/components/tracks/Fader";
import { volumeToFader, faderToVolume, formatDb, meterPercent } from "@/components/tracks/faderLaw";

interface TracksControlProps {
  settings: any;
}

// After a fader is released REAPER may still report the old value for a
// poll or two - hold the local value a little longer so it doesn't jump.
const HOLD_AFTER_RELEASE_MS = 800;
// Max ~10 volume updates per second per fader (the proxy allows 20/s per URL)
const SEND_INTERVAL_MS = 100;

const isLiveStem = (name: string) => /\[LIVE\]/i.test(name);

const OUTPUT_LABEL: Record<string, string> = {
  multi: "Uitgangen: 8 kanalen (X32)",
  "2ch": "Uitgangen: 1 = Click + Guide · 2 = Tracks",
  "3ch": "Uitgangen: 1 = Click + Guide · 2 + 3 = Tracks (stereo)",
  stereo: "Uitgangen: stereo (test)",
};
const stemLabel = (name: string) => name.replace(/\s*\[LIVE\]\s*/i, "").trim();

export default function TracksControl({ settings }: TracksControlProps) {
  const isEnabled = !!settings?.reaperEnabled;
  const { state, setState, error } = useReaperState(isEnabled);
  const [openBus, setOpenBus] = useState<number | null>(null);
  const [view, setView] = useState<"live" | "library">("live");
  const [localFaders, setLocalFaders] = useState<{ [track: number]: number }>({});
  const [statusMessage, setStatusMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const holdUntil = useRef<{ [track: number]: number }>({});
  const lastSent = useRef<{ [track: number]: number }>({});
  const pendingSend = useRef<{ [track: number]: NodeJS.Timeout }>({});

  const showStatus = useCallback((type: "success" | "error", text: string) => {
    setStatusMessage({ type, text });
    setTimeout(() => setStatusMessage(null), 3000);
  }, []);
  const showError = useCallback((text: string) => showStatus("error", text), [showStatus]);
  const showSuccess = useCallback((text: string) => showStatus("success", text), [showStatus]);

  // Drop local fader overrides once their hold time has passed, so REAPER's
  // own value (e.g. changed in REAPER itself) shows again.
  useEffect(() => {
    if (!state) return;
    const now = Date.now();
    setLocalFaders(prev => {
      const next = { ...prev };
      let changed = false;
      for (const key of Object.keys(next)) {
        if ((holdUntil.current[+key] || 0) < now) {
          delete next[+key];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [state]);

  const send = async (body: object, okText?: string) => {
    try {
      const res = await fetch("/api/reaper", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
      if (okText) showStatus("success", okText);
      return true;
    } catch (err) {
      showStatus("error", err instanceof Error ? err.message : "Actie mislukt");
      return false;
    }
  };

  const setFader = (track: number, f: number, final = false) => {
    setLocalFaders(prev => ({ ...prev, [track]: f }));
    holdUntil.current[track] = Date.now() + (final ? HOLD_AFTER_RELEASE_MS : 60_000);

    clearTimeout(pendingSend.current[track]);
    const doSend = () => {
      lastSent.current[track] = Date.now();
      send({ action: "volume", track, value: faderToVolume(f), final });
    };
    const wait = SEND_INTERVAL_MS - (Date.now() - (lastSent.current[track] || 0));
    if (final || wait <= 0) doSend();
    else pendingSend.current[track] = setTimeout(doSend, wait);
  };

  const unmuteAll = async () => {
    if (!confirm("Alle groepen en stems unmuten, ook de [LIVE]-stems die de band normaal zelf speelt?")) return;
    if (await send({ action: "unmuteAll" })) showSuccess("Alles staat aan.");
  };

  const toggle = (track: ReaperTrack, action: "mute" | "solo") => {
    const on = action === "mute" ? !track.muted : !track.soloed;
    // Optimistic, the next poll confirms it
    setState(prev => prev && {
      ...prev,
      busses: prev.busses.map(b => ({
        ...b,
        track: b.track.index === track.index ? { ...b.track, [action === "mute" ? "muted" : "soloed"]: on } : b.track,
        stems: b.stems.map(s => s.index === track.index ? { ...s, [action === "mute" ? "muted" : "soloed"]: on } : s),
      })),
    });
    send({ action, track: track.index, value: on });
  };

  // Without the track computer (REAPER off) the library stays usable: uploads
  // also feed the practice player ("Oefenen"), which doesn't need REAPER
  if (!isEnabled) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
        <div className="glass-card" style={{ padding: "28px", textAlign: "center", display: "flex", flexDirection: "column", gap: "12px", alignItems: "center" }}>
          <SlidersHorizontal size={40} style={{ color: "var(--primary)", opacity: 0.5 }} />
          <h3 style={{ fontSize: "1.15rem", fontWeight: "bold" }}>Koppeling met REAPER staat uit</h3>
          <p style={{ color: "var(--muted)", maxWidth: "520px", fontSize: "0.88rem", lineHeight: "1.6" }}>
            Faders, setlist en arrangement werken pas als &quot;Tracks (REAPER)&quot; aanstaat bij &quot;Instellingen&quot; en de track-computer bereikbaar is.
            Tracks uploaden voor de oefenspeler kan hieronder wel.
          </p>
        </div>
        <TrackLibraryPanel onError={showError} onStatus={showSuccess} />
        {statusMessage && <div className={`trk-toast ${statusMessage.type}`}>{statusMessage.text}</div>}
      </div>
    );
  }

  const playState = state?.playState || 0;
  const openBusData = state?.busses.find(b => b.track.index === openBus);

  // One channel strip like on a desk: value, fader + meter, M/S, name
  const renderFader = (track: ReaperTrack, label: string, opts: { sub?: string; live?: boolean; bus?: boolean; stemCount?: number }) => {
    const f = localFaders[track.index] ?? volumeToFader(track.volume);
    const meter = playState === 1 || playState === 5 ? meterPercent(track.meterDb) : 0;
    return (
      <div key={track.index} className={`mx-strip${track.muted ? " muted" : ""}${track.soloed ? " soloed" : ""}${opts.bus ? " bus" : ""}`}>
        <span className="mx-value">{formatDb(f)}</span>
        <Fader value={f} meter={meter} label={label} bus={opts.bus} onChange={(v, final) => setFader(track.index, v, final)} />
        <div className="mx-ms">
          <button className={`mx-btn mute${track.muted ? " on" : ""}`} onClick={() => toggle(track, "mute")} aria-pressed={track.muted} title={track.muted ? "Gemute – tik om aan te zetten" : "Mute"}>M</button>
          <button className={`mx-btn solo${track.soloed ? " on" : ""}`} onClick={() => toggle(track, "solo")} aria-pressed={track.soloed} title={track.soloed ? "Solo aan – tik om uit te zetten" : "Solo"}>S</button>
        </div>
        <span className="mx-name" title={label}>{label}</span>
        <div className="mx-tags">
          {track.muted && <span className="mx-badge muted">MUTE</span>}
          {opts.live && <span className="mx-badge live">LIVE</span>}
          {opts.sub && <span className="mx-badge out">{opts.sub}</span>}
        </div>
        {opts.bus && (
          <button
            className={`mx-stems${openBus === track.index ? " open" : ""}`}
            onClick={() => setOpenBus(openBus === track.index ? null : track.index)}
            disabled={!opts.stemCount}
            title="Stems van deze groep"
          >
            {opts.stemCount || 0} stems {openBus === track.index ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
        )}
      </div>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      <div className="trk-views" role="tablist">
        <button role="tab" aria-selected={view === "live"} className={`trk-view${view === "live" ? " on" : ""}`} onClick={() => setView("live")}>
          <Radio size={15} /> Live
        </button>
        <button role="tab" aria-selected={view === "library"} className={`trk-view${view === "library" ? " on" : ""}`} onClick={() => setView("library")}>
          <Library size={15} /> Bibliotheek
        </button>
        <Link href="/tracks" className="trk-stage-link">
          <MonitorSmartphone size={16} /> Podiumweergave (telefoon/tablet)
        </Link>
      </div>

      {view === "library" ? (
        <TrackLibraryPanel onError={showError} onStatus={showSuccess} />
      ) : (<>
      {error && (
        <div className="glass-card" style={{ display: "flex", gap: "12px", alignItems: "center", borderColor: "rgba(248,113,113,0.4)" }}>
          <AlertTriangle size={20} color="#f87171" />
          <div>
            <strong>REAPER niet bereikbaar</strong>
            <p style={{ color: "var(--muted)", fontSize: "0.8rem", marginTop: "4px" }}>
              {error}. Controleer of REAPER draait op de track-computer en de webinterface aan staat (REAPER → Settings → Control/OSC/web).
            </p>
          </div>
        </div>
      )}

      <TransportBar state={state} onError={showError} onSaved={() => showSuccess("Project opgeslagen in REAPER.")} showSave />

      <div className="trk-two-col">
        <SetlistPanel state={state} onError={showError} onStatus={showSuccess} />
        <SectionsPanel state={state} onError={showError} />
      </div>

      <PadsPanel state={state} onError={showError} />

      <TimingRecorder state={state} onError={showError} onStatus={showSuccess} />

      {/* Busses */}
      <section className="glass-card">
        <div className="mx-head">
          <h3 className="trk-title"><SlidersHorizontal size={18} style={{ color: "var(--primary)" }} /> Groepen</h3>
          {state?.bridge?.output && (
            <span className="mx-badge out" title={`Instelling: ${state.bridge.outputMode || "auto"} (Instellingen → Tracks)`}>
              {OUTPUT_LABEL[state.bridge.output] || state.bridge.output}
            </span>
          )}
          <button className="mx-unmute" onClick={unmuteAll} disabled={!state?.busses.some(b => b.track.muted || b.stems.some(s => s.muted))}>
            Alles unmuten
          </button>
        </div>
        {state && state.busses.length === 0 ? (
          <p style={{ color: "var(--muted)", fontSize: "0.85rem", display: "flex", gap: "8px", alignItems: "center" }}>
            <Music size={16} /> Geen bussen gevonden in het geopende REAPER-project. Open een song die met mt2reaper is gemaakt.
          </p>
        ) : (
          <div className="mx-rack">
            {state?.busses.map(b => renderFader(b.track, b.label, {
              sub: b.out ? `Out ${b.out}` : undefined,
              bus: true,
              stemCount: b.stems.length,
            }))}
          </div>
        )}
      </section>

      {/* Stems of the opened bus */}
      {openBusData && (
        <section className="glass-card">
          <div className="mx-head">
            <h3 className="trk-title"><SlidersHorizontal size={18} style={{ color: "#f97316" }} /> Stems – {openBusData.label}</h3>
          </div>
          <p className="trk-arr-hint">
            Stems met <span className="mx-badge live">LIVE</span> speelt de band normaal zelf en staan gemute. Mist er iemand? Zet de M uit.
          </p>
          <div className="mx-rack">
            {openBusData.stems.map(s => renderFader(s, stemLabel(s.name), { live: isLiveStem(s.name) }))}
          </div>
        </section>
      )}

      </>)}

      {statusMessage && (
        <div className={`trk-toast ${statusMessage.type}`}>{statusMessage.text}</div>
      )}

    </div>
  );
}
