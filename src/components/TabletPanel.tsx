"use client";
/* eslint-disable @typescript-eslint/no-explicit-any -- API-antwoorden zijn los gestructureerd JSON */

import React, { useCallback, useEffect, useRef, useState } from "react";

// Tabletpagina voor de regiekamer (/tablet): de basis aan- en uitzetten op één scherm.
// Gebruikt dezelfde API's als het Control Center en de Lichtregie; de server laat het tablet alleen daar bij (zie lib/tabletAuth.ts).

interface Plug { id: string; name: string; state?: string; is_online?: boolean }
interface AutoLight { available: boolean; auto: string }
interface Obs { connected?: boolean; obsStats?: { outputActive?: boolean } | null }

// Volgorde waarin "Alles aan" de stekkers start (geluid en licht eerst; de pc's daarna). "Alles uit" gaat andersom.
const PLUG_ORDER = ["plug_offgridtec_obs_all", "plug_offgridtec_mac_mini", "plug_obs", "plug_beamer"];

// Drie knoppen voor de onderdelen die los gebruikt worden: bij bandrepetitie hoeven de beamer en OBS niet aan.
const GROEPEN = [
  { key: "obs", naam: "OBS-pc", sub: "livestream", plugs: ["plug_obs"] },
  { key: "beamer", naam: "Beamer-pc", sub: "FreeShow", plugs: ["plug_beamer"] },
  { key: "band", naam: "Tracks + Licht/Audio", sub: "Ark Tracks, geluid & licht", plugs: ["plug_offgridtec_obs_all", "plug_offgridtec_mac_mini"] },
];

const FRESNELS = [1, 2, 3, 4];

const css = `
.tb{min-height:100vh;padding:18px;background:var(--background,#020617);color:var(--foreground,#f8fafc);font-family:inherit;-webkit-tap-highlight-color:transparent;user-select:none}
.tb h2{margin:0 0 12px;font-size:1.05rem;letter-spacing:.04em;text-transform:uppercase;color:#94a3b8}
.tb-sec{background:rgba(15,23,42,.7);border:1px solid rgba(51,65,85,.5);border-radius:16px;padding:16px;margin-bottom:16px}
.tb-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px}
.tb-btn{min-height:92px;border-radius:14px;border:2px solid rgba(148,163,184,.35);background:rgba(30,41,59,.8);color:inherit;font-size:1.2rem;font-weight:700;padding:10px 12px;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;text-align:center}
.tb-btn:active{transform:scale(.97);filter:brightness(1.25)}
.tb-btn[disabled]{opacity:.45;cursor:not-allowed}
.tb-btn small{font-size:.85rem;font-weight:600;opacity:.85}
.tb-on{border-color:#22c55e;background:rgba(34,197,94,.18)}
.tb-off{border-color:#64748b}
.tb-part{border-color:#f59e0b;background:rgba(245,158,11,.15)}
.tb-bad{border-color:#ef4444;background:rgba(239,68,68,.15)}
.tb-big{min-height:110px;font-size:1.5rem}
.tb-go{border-color:#22c55e;background:rgba(34,197,94,.25)}
.tb-stop{border-color:#ef4444;background:rgba(239,68,68,.25)}
.tb-sfeer{border-color:#f59e0b;background:rgba(245,158,11,.22)}
.tb-bar{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;margin-bottom:16px}
.tb-chip{padding:6px 14px;border-radius:999px;font-weight:700;font-size:.95rem;border:2px solid rgba(148,163,184,.4)}
.tb-note{position:fixed;left:18px;right:18px;bottom:18px;background:#0f172a;border:2px solid #38bdf8;border-radius:14px;padding:14px 18px;font-size:1.05rem;z-index:20}
.tb-modal{position:fixed;inset:0;background:rgba(2,6,23,.85);display:flex;align-items:center;justify-content:center;z-index:30;padding:20px}
.tb-modal>div{background:#0f172a;border:2px solid #475569;border-radius:18px;padding:24px;max-width:480px;width:100%}
.tb-pad{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;max-width:340px;margin:16px auto}
.tb-pad .tb-btn{min-height:72px;font-size:1.6rem}
.tb-fader{display:flex;align-items:center;gap:16px;margin-top:16px}
.tb-fader input[type=range]{flex:1;height:56px;accent-color:#f59e0b}
.tb-fader b{min-width:64px;text-align:right;font-size:1.4rem}
`;

export default function TabletPanel({ pinSet, authed: authedInit }: { pinSet: boolean; authed: boolean }) {
  const [authed, setAuthed] = useState(authedInit);
  const [pin, setPin] = useState("");
  const [pinErr, setPinErr] = useState("");
  const [plugs, setPlugs] = useState<Plug[] | null>(null);
  const [obs, setObs] = useState<Obs | null>(null);
  const [auto, setAuto] = useState<AutoLight | null>(null);
  const [fresnel, setFresnel] = useState(0);              // 0-100 (%)
  const [note, setNote] = useState("");
  const [confirm, setConfirm] = useState<null | { text: string; ok: () => void }>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(new Date());
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const faderTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const faderTouched = useRef(0);

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

  // Echte stand van de Fresnel-schuif (QLC+-schuif 81) volgen, zodat de fader klopt als het licht ergens anders is verzet
  useEffect(() => {
    if (!authed) return;
    const es = new EventSource("/api/qlc/stream");
    es.onmessage = (e) => {
      const p = String(e.data).split("|");
      if (p.length >= 3 && p[0] === "81" && p[1] === "SLIDER" && Date.now() - faderTouched.current > 1500) {
        const v = parseInt(p[2]);
        if (!isNaN(v)) setFresnel(Math.round((v / 255) * 100));
      }
    };
    return () => es.close();
  }, [authed]);

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
    const press = (d: string) => setPin((pin + d).slice(0, 12));
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

  const byId = (id: string) => (plugs || []).find(p => p.id === id);
  const status = (p: Plug): "on" | "off" | "offline" => (p.is_online === false ? "offline" : p.state === "on" ? "on" : "off");
  const streaming = !!obs?.obsStats?.outputActive;

  // Eén stekker schakelen; de server kiest de goede sequentie (opstarten of netjes afsluiten) en slaat over wat al klopt
  const plugCall = async (p: Plug, action: "on" | "off") => {
    try {
      const r = await api("/api/tuya/power", { plugId: p.id, action });
      say(`${p.name}: ${r.data.message || r.data.error || (r.ok ? "gedaan" : "mislukt")}`);
      return r.ok;
    } catch (e: any) { say(`${p.name}: ${e?.message || "mislukt"}`); return false; }
  };

  // Alleen de stekkers die nog niet in de gewenste stand staan (slim: wat al aan of uit is, blijft zoals het is)
  const run = async (ids: string[], action: "on" | "off") => {
    const todo = ids.map(byId).filter((p): p is Plug => !!p && status(p) === (action === "on" ? "off" : "on"));
    setBusy(true);
    for (let i = 0; i < todo.length; i++) {
      await plugCall(todo[i], action);
      if (i < todo.length - 1) await new Promise(r => setTimeout(r, 2000));
    }
    setBusy(false);
    setTimeout(loadPlugs, 1500);
    return todo.length;
  };

  const allOn = async () => { if (!(await run(PLUG_ORDER, "on"))) say("Alles staat al aan."); };
  const allOff = () => {
    if (streaming) { say("De livestream loopt nog. Stop eerst de uitzending."); return; }
    const aan = [...PLUG_ORDER].reverse().map(byId).filter((p): p is Plug => !!p && status(p) === "on");
    if (aan.length === 0) { say("Alles staat al uit."); return; }
    setConfirm({ text: `Afsluiten: ${aan.map(p => p.name).join(", ")}?`, ok: () => { run([...PLUG_ORDER].reverse(), "off"); } });
  };

  const groupState = (ids: string[]) => {
    const ps = ids.map(byId).filter((p): p is Plug => !!p);
    if (ps.length === 0) return null;
    const st = ps.map(status);
    const label = st.includes("offline") ? "OFFLINE" : st.every(s => s === "on") ? "AAN" : st.every(s => s === "off") ? "UIT" : "DEELS AAN";
    return { ps, label, cls: label === "AAN" ? "tb-on" : label === "UIT" ? "tb-off" : label === "OFFLINE" ? "tb-bad" : "tb-part" };
  };
  const tapGroup = (g: typeof GROEPEN[number]) => {
    const s = groupState(g.plugs);
    if (!s) return;
    if (s.label === "OFFLINE") { say(`${g.naam}: een stekker is offline.`); return; }
    if (s.label === "AAN") setConfirm({ text: `${g.naam} afsluiten?`, ok: () => { run([...g.plugs].reverse(), "off"); } });
    else run(g.plugs, "on");
  };

  const sfeer = async () => {
    try {
      const r = await api("/api/tablet/sfeer", {});
      if (!r.ok) throw new Error(r.data.error || "mislukt");
      say(`Ark Sfeer gezet (${r.data.label}).`);
    } catch (e: any) { say(`Ark Sfeer: ${e?.message || "mislukt"}`); }
  };
  const lichtUit = async () => {
    try {
      const r = await api("/api/qlc/action", { action: "resetAll" });
      if (!r.ok) throw new Error(r.data.error || "mislukt");
      setFresnel(0); say("Licht uit.");
    } catch (e: any) { say(`Licht uit: ${e?.message || "mislukt"}`); }
  };
  const setAutoLight = async (v: "aan" | "uit") => {
    setAuto(a => (a ? { ...a, auto: v } : a));
    try {
      const r = await api("/api/lights/auto", { auto: v });
      if (!r.ok) throw new Error(r.data.error || "mislukt");
      say(v === "aan" ? "Automatisch licht staat AAN (FreeShow stuurt het licht)." : "Automatisch licht staat UIT.");
    } catch (e: any) { say(`Automatisch licht: ${e?.message || "mislukt"}`); loadAuto(); }
  };

  // Eén fader voor alle vier de Fresnels tegelijk (0-100% van de schuif)
  const moveFader = (pct: number) => {
    setFresnel(pct);
    faderTouched.current = Date.now();
    if (faderTimer.current) clearTimeout(faderTimer.current);
    faderTimer.current = setTimeout(async () => {
      const value = Math.round((pct / 100) * 255);
      try { await Promise.all(FRESNELS.map(n => api("/api/qlc/action", { path: `/ark/light/fresnel/${n}`, value }))); }
      catch (e: any) { say(`Fresnels: ${e?.message || "mislukt"}`); }
    }, 120);
  };

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
          <button className="tb-btn tb-big tb-go" disabled={busy} onClick={allOn}>ALLES AAN<small>zet aan wat nog uit staat</small></button>
          <button className="tb-btn tb-big tb-stop" disabled={busy} onClick={allOff}>ALLES UIT<small>sluit af wat nog aan staat</small></button>
        </div>
      </div>

      <div className="tb-sec">
        <h2>Per onderdeel</h2>
        <div className="tb-grid">
          {plugs === null && <div style={{ color: "#94a3b8" }}>Laden&hellip;</div>}
          {GROEPEN.map(g => {
            const s = groupState(g.plugs);
            if (!s) return null;
            return (
              <button key={g.key} className={`tb-btn tb-big ${s.cls}`} disabled={busy} onClick={() => tapGroup(g)}>
                {g.naam}<small>{s.label} &middot; {g.sub}</small>
              </button>
            );
          })}
        </div>
      </div>

      <div className="tb-sec">
        <h2>Licht</h2>
        <div className="tb-grid">
          <button className="tb-btn tb-sfeer" onClick={sfeer}>ARK SFEER<small>standaard licht</small></button>
          <button className="tb-btn tb-stop" onClick={lichtUit}>LICHT UIT<small>alle lampen uit</small></button>
          <button className={`tb-btn ${auto?.available ? (auto.auto === "aan" ? "tb-on" : "tb-bad") : "tb-off"}`} disabled={!auto?.available} onClick={() => setAutoLight(auto?.auto === "aan" ? "uit" : "aan")}>
            Automatisch licht<small>{auto?.available ? (auto.auto === "aan" ? "AAN (FreeShow stuurt)" : "UIT") : "niet beschikbaar"}</small>
          </button>
        </div>
        <div style={{ marginTop: 18, fontWeight: 700 }}>Fresnels (alle vier samen)</div>
        <div className="tb-fader">
          <span>zachter</span>
          <input type="range" min={0} max={100} value={fresnel} onChange={e => moveFader(parseInt(e.target.value))} />
          <span>harder</span>
          <b>{fresnel}%</b>
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
