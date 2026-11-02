"use client";
/* eslint-disable @typescript-eslint/no-explicit-any -- API-antwoorden zijn los gestructureerd JSON */

import React, { useCallback, useEffect, useRef, useState } from "react";

// Tabletpagina voor de regiekamer (/tablet): stekkers, licht, Alles aan/uit en de livestream op één scherm.
// Gebruikt dezelfde API's als het Control Center en de Lichtregie; de server laat het tablet alleen daar bij (zie lib/tabletAuth.ts).

interface Plug { id: string; name: string; state?: string; is_online?: boolean }
interface AutoLight { available: boolean; auto: string; kleur?: string; tijd?: string }
interface Obs { connected?: boolean; obsStats?: { outputActive?: boolean } | null; bitrateKbps?: number }

// Volgorde waarin "Alles aan" de stekkers start (geluid en licht eerst; de pc's daarna)
const PLUG_ORDER = ["plug_offgridtec_obs_all", "plug_offgridtec_mac_mini", "plug_obs", "plug_beamer"];

const SCENES = [
  { id: 1, name: "WARM STAGE", color: "#f97316" },
  { id: 2, name: "WORSHIP BLUE", color: "#3b82f6" },
  { id: 3, name: "PRE-SERVICE", color: "#a855f7" },
  { id: 4, name: "FULL HOUSE", color: "#e2e8f0" },
];
// Alle lampen (master): QLC+-functies 10 t/m 17, dezelfde nummering als op de Lichtregie-pagina (startId 10 + kleurvolgorde)
const COLORS = [
  { id: 10, name: "Rood", color: "#ef4444" }, { id: 11, name: "Groen", color: "#22c55e" },
  { id: 12, name: "Blauw", color: "#3b82f6" }, { id: 13, name: "Amber", color: "#f59e0b" },
  { id: 14, name: "Magenta", color: "#d946ef" }, { id: 15, name: "Cyaan", color: "#06b6d4" },
  { id: 16, name: "UV", color: "#8b5cf6" }, { id: 17, name: "Wit", color: "#ffffff" },
];

const css = `
.tb{min-height:100vh;padding:18px;background:var(--background,#020617);color:var(--foreground,#f8fafc);font-family:inherit;-webkit-tap-highlight-color:transparent;user-select:none}
.tb h2{margin:0 0 12px;font-size:1.05rem;letter-spacing:.04em;text-transform:uppercase;color:#94a3b8}
.tb-sec{background:rgba(15,23,42,.7);border:1px solid rgba(51,65,85,.5);border-radius:16px;padding:16px;margin-bottom:16px}
.tb-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px}
.tb-btn{min-height:84px;border-radius:14px;border:2px solid rgba(148,163,184,.35);background:rgba(30,41,59,.8);color:inherit;font-size:1.15rem;font-weight:700;padding:10px 12px;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;text-align:center}
.tb-btn:active{transform:scale(.97);filter:brightness(1.25)}
.tb-btn[disabled]{opacity:.45;cursor:not-allowed}
.tb-btn small{font-size:.8rem;font-weight:600;opacity:.85}
.tb-on{border-color:#22c55e;background:rgba(34,197,94,.18)}
.tb-off{border-color:#64748b}
.tb-bad{border-color:#ef4444;background:rgba(239,68,68,.15)}
.tb-big{min-height:104px;font-size:1.4rem}
.tb-go{border-color:#22c55e;background:rgba(34,197,94,.25)}
.tb-stop{border-color:#ef4444;background:rgba(239,68,68,.25)}
.tb-sw{width:18px;height:18px;border-radius:50%;border:2px solid rgba(255,255,255,.5);display:inline-block}
.tb-bar{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;margin-bottom:16px}
.tb-chip{padding:6px 14px;border-radius:999px;font-weight:700;font-size:.95rem;border:2px solid rgba(148,163,184,.4)}
.tb-note{position:fixed;left:18px;right:18px;bottom:18px;background:#0f172a;border:2px solid #38bdf8;border-radius:14px;padding:14px 18px;font-size:1.05rem;z-index:20}
.tb-modal{position:fixed;inset:0;background:rgba(2,6,23,.85);display:flex;align-items:center;justify-content:center;z-index:30;padding:20px}
.tb-modal>div{background:#0f172a;border:2px solid #475569;border-radius:18px;padding:24px;max-width:480px;width:100%}
.tb-pad{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;max-width:340px;margin:16px auto}
.tb-pad .tb-btn{min-height:72px;font-size:1.6rem}
`;

export default function TabletPanel({ pinSet, authed: authedInit }: { pinSet: boolean; authed: boolean }) {
  const [authed, setAuthed] = useState(authedInit);
  const [pin, setPin] = useState("");
  const [pinErr, setPinErr] = useState("");
  const [plugs, setPlugs] = useState<Plug[] | null>(null);
  const [obs, setObs] = useState<Obs | null>(null);
  const [auto, setAuto] = useState<AutoLight | null>(null);
  const [lastLight, setLastLight] = useState<string>("");
  const [note, setNote] = useState("");
  const [confirm, setConfirm] = useState<null | { text: string; ok: () => void }>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(new Date());
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const say = useCallback((t: string) => {
    setNote(t);
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setNote(""), 8000);
  }, []);

  const api = useCallback(async (url: string, body?: any) => {
    const res = await fetch(url, body === undefined ? { cache: "no-store" } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    let data: any = {};
    try { data = await res.json(); } catch { /* geen json */ }
    if (res.status === 401) { setAuthed(false); throw new Error("Opnieuw inloggen met de pincode"); }
    return { ok: res.ok, data };
  }, []);

  const loadPlugs = useCallback(async () => { try { const r = await api("/api/tuya/status"); if (r.ok) setPlugs(r.data.plugs || []); } catch { /* volgende ronde */ } }, [api]);
  const loadObs = useCallback(async () => { try { const r = await api("/api/obs/status"); if (r.ok) setObs(r.data); } catch { /* volgende ronde */ } }, [api]);
  const loadAuto = useCallback(async () => { try { const r = await api("/api/lights/auto"); if (r.ok) setAuto(r.data); } catch { /* volgende ronde */ } }, [api]);

  useEffect(() => {
    const clock = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(clock);
  }, []);
  useEffect(() => {
    if (!authed) return;
    loadPlugs(); loadObs(); loadAuto();
    const a = setInterval(loadPlugs, 5000);
    const b = setInterval(loadObs, 3000);
    const c = setInterval(loadAuto, 10000);
    return () => { clearInterval(a); clearInterval(b); clearInterval(c); };
  }, [authed, loadPlugs, loadObs, loadAuto]);

  const login = async (value: string) => {
    setPinErr("");
    const res = await fetch("/api/tablet/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin: value }) });
    const data = await res.json().catch(() => ({}));
    if (res.ok) { setAuthed(true); setPin(""); } else { setPinErr(data.error || "Inloggen mislukt"); setPin(""); }
  };

  if (!pinSet) {
    return (<div className="tb"><style>{css}</style><div className="tb-sec"><h2>Regiekamer</h2><p>De tablet-pincode is nog niet ingesteld. Stel hem in via <b>Instellingen &rarr; Verbindingen &rarr; Tablet regiekamer</b> en laad deze pagina opnieuw.</p></div></div>);
  }

  if (!authed) {
    const press = (d: string) => { const next = (pin + d).slice(0, 12); setPin(next); };
    return (
      <div className="tb"><style>{css}</style>
        <div className="tb-sec" style={{ maxWidth: 420, margin: "40px auto", textAlign: "center" }}>
          <h2>Regiekamer</h2>
          <div style={{ fontSize: "2rem", letterSpacing: ".4em", minHeight: 48 }}>{"●".repeat(pin.length) || " "}</div>
          {pinErr && <div style={{ color: "#fca5a5", marginTop: 6 }}>{pinErr}</div>}
          <div className="tb-pad">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map(d => <button key={d} className="tb-btn" onClick={() => press(d)}>{d}</button>)}
            <button className="tb-btn" onClick={() => setPin(pin.slice(0, -1))}>&larr;</button>
            <button className="tb-btn" onClick={() => press("0")}>0</button>
            <button className="tb-btn tb-go" disabled={!pin} onClick={() => login(pin)}>OK</button>
          </div>
        </div>
      </div>
    );
  }

  const known = PLUG_ORDER.map(id => (plugs || []).find(p => p.id === id)).filter(Boolean) as Plug[];
  const streaming = !!obs?.obsStats?.outputActive;

  const plugCall = async (p: Plug, action?: "on" | "off") => {
    try {
      const r = await api("/api/tuya/power", { plugId: p.id, ...(action ? { action } : {}) });
      say(`${p.name}: ${r.data.message || r.data.error || (r.ok ? "gedaan" : "mislukt")}`);
      return r.ok;
    } catch (e: any) { say(`${p.name}: ${e?.message || "mislukt"}`); return false; }
    finally { setTimeout(loadPlugs, 1500); }
  };

  const tapPlug = (p: Plug) => {
    if (p.is_online === false) { say(`${p.name} is offline.`); return; }
    if (p.state === "on") setConfirm({ text: `${p.name} afsluiten en uitzetten?`, ok: () => plugCall(p, "off") });
    else plugCall(p, "on");
  };

  const allOn = async () => {
    setBusy(true);
    for (const p of known) { await plugCall(p, "on"); await new Promise(r => setTimeout(r, 2000)); }
    setBusy(false);
  };
  const allOff = () => {
    if (streaming) { say("De livestream loopt nog. Stop eerst de uitzending."); return; }
    setConfirm({ text: "Alles afsluiten? De pc's worden netjes afgesloten en geluid en licht gaan uit.", ok: async () => {
      setBusy(true);
      for (const p of [...known].reverse()) { await plugCall(p, "off"); await new Promise(r => setTimeout(r, 2000)); }
      setBusy(false);
    } });
  };

  const light = async (label: string, body: any) => {
    try {
      const r = await api("/api/qlc/action", body);
      if (!r.ok) throw new Error(r.data.error || "mislukt");
      setLastLight(label); say(`Licht: ${label}`);
    } catch (e: any) { say(`Licht ${label}: ${e?.message || "mislukt"}`); }
  };
  const setAutoLight = async (v: "aan" | "uit") => {
    setAuto(a => (a ? { ...a, auto: v } : a));
    try {
      const r = await api("/api/lights/auto", { auto: v });
      if (!r.ok) throw new Error(r.data.error || "mislukt");
      say(v === "aan" ? "Automatisch licht staat AAN (FreeShow stuurt het licht)." : "Automatisch licht staat UIT.");
    } catch (e: any) { say(`Automatisch licht: ${e?.message || "mislukt"}`); loadAuto(); }
  };

  const toggleStream = () => setConfirm({
    text: streaming ? "De livestream STOPPEN?" : "De livestream STARTEN?",
    ok: async () => {
      try {
        const r = await api("/api/obs/action", { action: "ToggleStream" });
        say(r.ok ? (streaming ? "Livestream wordt gestopt." : "Livestream wordt gestart.") : (r.data.error || "mislukt"));
      } catch (e: any) { say(e?.message || "mislukt"); }
      setTimeout(loadObs, 1500);
    },
  });

  const plugCls = (p: Plug) => (p.is_online === false ? "tb-bad" : p.state === "on" ? "tb-on" : "tb-off");
  const plugTxt = (p: Plug) => (p.is_online === false ? "OFFLINE" : p.state === "on" ? "AAN" : "UIT");

  return (
    <div className="tb"><style>{css}</style>
      <div className="tb-bar">
        <div style={{ fontSize: "1.6rem", fontWeight: 800 }}>Regiekamer</div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span className="tb-chip" style={{ color: obs?.connected ? "#86efac" : "#fca5a5" }}>OBS {obs?.connected ? "verbonden" : "niet verbonden"}</span>
          <span className="tb-chip" style={{ color: streaming ? "#fca5a5" : "#94a3b8", borderColor: streaming ? "#ef4444" : undefined }}>{streaming ? "LIVE" : "niet live"}</span>
          <span style={{ fontSize: "1.6rem", fontWeight: 700 }}>{now.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}</span>
        </div>
      </div>

      <div className="tb-sec">
        <h2>Alles</h2>
        <div className="tb-grid">
          <button className="tb-btn tb-big tb-go" disabled={busy} onClick={allOn}>ALLES AAN<small>geluid &amp; licht, pc&apos;s</small></button>
          <button className="tb-btn tb-big tb-stop" disabled={busy} onClick={allOff}>ALLES UIT<small>pc&apos;s netjes afsluiten</small></button>
        </div>
      </div>

      <div className="tb-sec">
        <h2>Stekkers</h2>
        <div className="tb-grid">
          {known.length === 0 && <div style={{ color: "#94a3b8" }}>{plugs === null ? "Laden…" : "Geen stekkers gevonden"}</div>}
          {known.map(p => (
            <button key={p.id} className={`tb-btn ${plugCls(p)}`} onClick={() => tapPlug(p)}>{p.name}<small>{plugTxt(p)}</small></button>
          ))}
        </div>
      </div>

      <div className="tb-sec">
        <h2>Licht</h2>
        <div className="tb-grid" style={{ marginBottom: 12 }}>
          <button className={`tb-btn ${auto?.available ? (auto.auto === "aan" ? "tb-on" : "tb-bad") : "tb-off"}`} disabled={!auto?.available} onClick={() => setAutoLight(auto?.auto === "aan" ? "uit" : "aan")}>
            Automatisch licht<small>{auto?.available ? (auto.auto === "aan" ? "AAN (FreeShow stuurt)" : "UIT") : "niet beschikbaar"}</small>
          </button>
          <button className="tb-btn tb-stop" onClick={() => light("BLACKOUT", { action: "resetAll" })}>BLACKOUT<small>alle lampen uit</small></button>
        </div>
        <div className="tb-grid" style={{ marginBottom: 12 }}>
          {SCENES.map(s => (
            <button key={s.id} className={`tb-btn ${lastLight === s.name ? "tb-on" : ""}`} onClick={() => light(s.name, { sceneId: s.id })}>
              <span className="tb-sw" style={{ background: s.color }} />{s.name}
            </button>
          ))}
        </div>
        <div className="tb-grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(110px,1fr))" }}>
          {COLORS.map(c => (
            <button key={c.id} className={`tb-btn ${lastLight === c.name ? "tb-on" : ""}`} style={{ minHeight: 64, fontSize: "1rem" }} onClick={() => light(c.name, { sceneId: c.id })}>
              <span className="tb-sw" style={{ background: c.color }} />{c.name}
            </button>
          ))}
        </div>
      </div>

      <div className="tb-sec">
        <h2>Livestream</h2>
        <div className="tb-grid">
          <button className={`tb-btn tb-big ${streaming ? "tb-stop" : "tb-go"}`} disabled={!obs?.connected} onClick={toggleStream}>
            {streaming ? "UITZENDING STOPPEN" : "UITZENDING STARTEN"}
            <small>{streaming ? `live${obs?.bitrateKbps ? ` · ${obs.bitrateKbps} kbps` : ""}` : obs?.connected ? "niet live" : "OBS niet verbonden"}</small>
          </button>
        </div>
      </div>

      <div className="tb-sec">
        <h2>Niet vergeten</h2>
        <div style={{ fontSize: "1.1rem" }}>Projector aan en uit met de <b>afstandsbediening</b>. Schakelaars bij het podium aan voor het licht.</div>
      </div>

      {note && <div className="tb-note">{note}</div>}
      {confirm && (
        <div className="tb-modal" onClick={() => setConfirm(null)}>
          <div onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: "1.3rem", fontWeight: 700, marginBottom: 20 }}>{confirm.text}</div>
            <div className="tb-grid">
              <button className="tb-btn" onClick={() => setConfirm(null)}>Annuleren</button>
              <button className="tb-btn tb-stop" onClick={() => { const f = confirm.ok; setConfirm(null); f(); }}>Ja, doorgaan</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
