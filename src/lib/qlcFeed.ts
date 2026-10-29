// One connection to QLC+ for everything that wants live DMX values, and a one-off read of the channel types (kept on disk, so the editor
// still knows which channel is red, green, a dimmer ... when QLC+ is not reachable at the moment).

import fs from "fs";
import path from "path";
import WebSocket from "ws";
import { getSettings } from "./settingsStore";
import { readFixtures, WORKSPACE_FILE } from "./qlcWorkspace";
import { customButtons } from "./qlcFunctions";

export interface Feed { functions: Record<number, string>; pending: number[]; poll: ReturnType<typeof setInterval> | null; values: number[]; types: string[]; version: number; ws: WebSocket | null; timer: ReturnType<typeof setInterval> | null; listeners: Set<() => void>; host: string; count: number; error: string }
const g = globalThis as unknown as { __qlcFeed?: Feed };

export function feed(): Feed {
  if (!g.__qlcFeed) g.__qlcFeed = { functions: {}, pending: [], poll: null, values: [], types: [], version: 0, ws: null, timer: null, listeners: new Set(), host: "", count: 0, error: "" };
  return g.__qlcFeed;
}

export function channelCount(): number {
  try { return Math.min(512, Math.max(16, ...readFixtures().map(f => f.address + f.channels + 1))); } catch { return 128; }
}

/** QLC+API|getChannelsValues|(<channel>|<value>|<type>|<flag>)*   (channels count from 1) */
export function parseChannels(raw: string): { values: number[]; types: string[] } | null {
  const parts = raw.split("|");
  if (parts[1] !== "getChannelsValues") return null;
  const values: number[] = [], types: string[] = [];
  for (let i = 2; i + 3 < parts.length; i += 4) {
    const ch = Number(parts[i]);
    if (!Number.isFinite(ch)) break;
    values[ch - 1] = Number(parts[i + 1]) || 0;
    types[ch - 1] = parts[i + 2] || "";
  }
  return { values, types };
}

export function startFeed(f: Feed) {
  const host = getSettings().qlcHost || "127.0.0.1";
  f.count = channelCount();
  if (f.ws && f.host === host) return;
  f.host = host;
  const ws = new WebSocket(`ws://${host}:9999/qlcplusWS`);
  f.ws = ws;
  ws.on("open", () => {
    f.error = "";
    f.timer = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send(`QLC+API|getChannelsValues|1|1|${f.count}`); }, 100);
    // the buttons of the web app's own scenes and chases: ask now and then whether they run (announcements only come when something changes)
    const ask = () => {
      if (ws.readyState !== WebSocket.OPEN) return;
      try {
        for (const b of customButtons(fs.readFileSync(WORKSPACE_FILE, "utf-8"))) { f.pending.push(b.id); ws.send(`QLC+API|getFunctionStatus|${b.id}`); }
      } catch { /* the workspace is being written */ }
      if (f.pending.length > 200) f.pending = [];
    };
    ask();
    f.poll = setInterval(ask, 3000);
  });
  ws.on("message", raw => {
    const text = String(raw);
    // function state: QLC+ announces changes ("FUNCTION|<id>|Running") and answers our questions ("QLC+API|getFunctionStatus|<state>", in order)
    const parts = text.split("|");
    let id: number | undefined, state: string | undefined;
    if (parts[0] === "FUNCTION" && parts.length >= 3) { id = Number(parts[1]); state = parts[2]; }
    else if (parts[0] === "QLC+API" && parts[1] === "getFunctionStatus" && parts.length === 3) { id = f.pending.shift(); state = parts[2]; }
    if (id !== undefined && state !== undefined && Number.isFinite(id)) {
      if (f.functions[id] !== state) { f.functions[id] = state; f.version++; f.listeners.forEach(l => l()); }
      return;
    }
    const r = parseChannels(text);
    if (!r) return;
    const changed = r.values.length !== f.values.length || r.values.some((v, i) => v !== f.values[i]) || r.types.join("") !== f.types.join("");
    f.values = r.values; f.types = r.types;
    if (r.types.some(Boolean)) saveTypes(r.types);
    if (changed) { f.version++; f.listeners.forEach(l => l()); }
  });
  const reset = () => {
    if (f.timer) clearInterval(f.timer);
    if (f.poll) clearInterval(f.poll);
    f.timer = null; f.poll = null; f.ws = null; f.pending = [];
    setTimeout(() => { if (f.listeners.size) startFeed(f); }, 2000);   // viewers still there: connect again
  };
  ws.on("close", reset);
  ws.on("error", err => { f.error = `QLC+ is niet bereikbaar op ${host}:9999 (${err.message})`; try { ws.close(); } catch { /* already closed */ } });
}

const TYPES_FILE = path.join(process.cwd(), "data", "lights_channel_types.json");

function saveTypes(types: string[]) {
  try {
    const old = fs.existsSync(TYPES_FILE) ? fs.readFileSync(TYPES_FILE, "utf-8") : "";
    const next = JSON.stringify(types);
    if (old !== next) { fs.mkdirSync(path.dirname(TYPES_FILE), { recursive: true }); fs.writeFileSync(TYPES_FILE, next); }
  } catch { /* not critical */ }
}

/** Channel types: from the running QLC+ if it answers, otherwise the last ones we saw */
export async function channelTypes(): Promise<{ types: string[]; source: "live" | "saved" | "none"; message: string }> {
  const f = feed();
  if (f.types.some(Boolean)) return { types: f.types, source: "live", message: "" };
  const host = getSettings().qlcHost || "127.0.0.1";
  const live = await new Promise<string[] | null>(resolve => {
    let done = false;
    const finish = (v: string[] | null) => { if (!done) { done = true; clearTimeout(timer); try { ws.close(); } catch { /* closed */ } resolve(v); } };
    const ws = new WebSocket(`ws://${host}:9999/qlcplusWS`);
    const timer = setTimeout(() => finish(null), 3000);
    ws.on("open", () => ws.send(`QLC+API|getChannelsValues|1|1|${channelCount()}`));
    ws.on("message", raw => { const r = parseChannels(String(raw)); if (r) finish(r.types); });
    ws.on("error", () => finish(null));
  });
  if (live && live.some(Boolean)) { saveTypes(live); return { types: live, source: "live", message: "" }; }
  try {
    const saved = JSON.parse(fs.readFileSync(TYPES_FILE, "utf-8"));
    if (Array.isArray(saved)) return { types: saved, source: "saved", message: `QLC+ is niet bereikbaar op ${host}:9999: de laatst bekende kanaalsoorten worden gebruikt.` };
  } catch { /* none saved */ }
  return { types: [], source: "none", message: `QLC+ is niet bereikbaar op ${host}:9999 en er zijn nog geen kanaalsoorten bekend.` };
}
