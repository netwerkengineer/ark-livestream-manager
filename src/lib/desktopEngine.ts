// Desktop app: the Tracks screens play on this computer (ark-player inside the app) instead of
// on the track computer. The app's window offers window.arkEngine; this module makes the existing
// screens work with it without changing them: it stands in for the REAPER state stream and for the
// requests the screens send to /api/reaper*, and answers them from the local engine.
//
// Outside the desktop app (no window.arkEngine) nothing here does anything.

import type { ReaperState, ReaperTrack, ReaperBus, BridgeState } from "./reaperControl";
import { parseSongName } from "../components/tracks/songName";

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface FetchJob { id: string; title: string; state: "wachtrij" | "ophalen" | "uitpakken" | "click" | "klaar" | "fout"; progress: number; message: string }
export interface ServerSong { id: string; title: string; key: string | null; bpm: number | null; size: number; own: boolean; rpp: string; folder: string; updatedAt: string }
interface ArkEngine { available: boolean; call: (path: string, params?: Record<string, unknown>) => Promise<any> }
declare global {
  interface Window {
    arkEngine?: ArkEngine;
    arkDesktop?: { offline?: boolean; version: string; server: string; openSettings: () => void; openExternal: (url: string) => void; chooseFolder: () => Promise<{ path: string }>; fetchSong: (song: { id: string; folder: string; title: string; rpp: string }) => void; fetchStatus: () => Promise<{ jobs: FetchJob[] }>; removeSong: (folder: string) => Promise<{ ok: boolean }>; importZip: () => void };
  }
}

export const hasDesktopEngine = () => typeof window !== "undefined" && !!window.arkEngine?.available;
/** Where "back" goes: the desktop app has no dashboard, only its own page */
/** The app runs from its own copy of the page, without a connection to the server */
export const isOffline = () => typeof window !== "undefined" && !!window.arkDesktop?.offline;
export const homeHref = () => (hasDesktopEngine() ? "/desktop" : "/");
export const engineCall = (path: string, params?: Record<string, unknown>) => window.arkEngine!.call(path, params);

// ------------------------------------------------------------- state

interface EngineState {
  title: string; path: string; state: "playing" | "paused" | "stopped"; position: number; position_beats: string; duration: number;
  loading: boolean; error: string; output_mode: string; output_applied: string; jump_mode: string; lead_beats: number; freeshow: string;
  has_cues: boolean; setlist: string[]; loaded: string[]; master_db: number; master_mute: boolean;
  sections: { id: number; region: number; name: string; start: number; end: number; start_qn: number; end_qn: number }[];
  stems: { name: string; bus: number; bus_name: string; mute: boolean; solo: boolean; live: boolean; gain: number; meter_db: number }[];
  busses: { bus: number; name: string; mute: boolean; solo: boolean; gain: number }[];
  section?: number; pending?: number; loop?: number; next_song?: string; pending_song?: string;
  recording?: boolean; rec_slide?: number; rec_slides?: number;
  pads?: ReaperState["pads"]; pads_error?: string;
}
interface LibSong { name: string; path: string; loaded: boolean }

// what a REAPER track number means in the local engine
type TrackRef = { kind: "stem"; name: string } | { kind: "bus"; bus: number };
let trackMap = new Map<number, TrackRef>();
let regionToIndex = new Map<number, number>();
let library: LibSong[] = [];

export function toReaperState(es: EngineState, lib: LibSong[]): ReaperState {
  const tracks = new Map<number, TrackRef>();
  let k = 1;
  const busses: ReaperBus[] = es.busses.map(b => {
    const stems = es.stems.filter(s => s.bus === b.bus);
    const peak = (list: { meter_db: number }[]) => list.reduce((m, s) => Math.max(m, s.meter_db), -150);
    const bus: ReaperTrack = { index: k, name: `${b.name} -> Out ${b.bus}`, folder: true, muted: b.mute, soloed: b.solo, volume: b.gain, meterDb: peak(stems) };
    tracks.set(k++, { kind: "bus", bus: b.bus });
    const list: ReaperTrack[] = stems.map(s => {
      const t: ReaperTrack = { index: k, name: s.name + (s.live ? " [LIVE]" : ""), folder: false, muted: s.mute, soloed: s.solo, volume: s.gain, meterDb: s.meter_db };
      tracks.set(k++, { kind: "stem", name: s.name });
      return t;
    });
    return { track: bus, out: b.bus, label: b.name, stems: list };
  });
  trackMap = tracks;
  regionToIndex = new Map(es.sections.map(s => [s.region, s.id]));

  const byFolder = new Map(lib.map(l => [l.path, l]));
  const active = es.path;
  const loadedSongs = lib.filter(l => l.loaded || l.path === active);
  const region = (idx?: number) => (idx === undefined ? undefined : es.sections[idx]?.region);
  const bridge: BridgeState = {
    songs: lib.map(l => ({ name: l.name, path: l.path })),
    setlist: es.setlist,
    tabs: loadedSongs.map(l => ({ name: l.name, path: l.path, active: l.path === active })),
    mode: (es.jump_mode as BridgeState["mode"]) || "end",
    loop: region(es.loop),
    pending: region(es.pending),
    region: region(es.section),
    lastCmd: "",
    error: es.error || undefined,
    outputMode: es.output_mode,
    leadBeats: es.lead_beats,
    freeshow: es.freeshow || undefined,
    nextSong: es.next_song,
    pendingSong: es.pending_song,
    hasCues: es.has_cues,
    master: es.master_db <= -90 ? 0 : Math.pow(10, es.master_db / 20),
    masterMute: es.master_mute,
    recording: es.recording,
    recSlide: es.rec_slide,
    recSlides: es.rec_slides,
    output: es.output_applied,
  };
  void byFolder;
  return {
    playState: es.state === "playing" ? 1 : es.state === "paused" ? 2 : 0,
    position: es.position,
    positionBeats: es.position_beats,
    regions: es.sections.map(s => ({ id: s.region, name: s.name, start: s.start, end: s.end })),
    busses,
    bridge,
    pads: es.pads ? { ...es.pads, error: es.pads_error || undefined } : null,
  };
}

// ------------------------------------------------------------- the stand-in for the state stream

class LocalEventSource {
  static readonly CONNECTING = 0; static readonly OPEN = 1; static readonly CLOSED = 2;
  readyState = 1;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  onopen: ((e: Event) => void) | null = null;
  private listeners = new Map<string, ((e: MessageEvent) => void)[]>();
  private timer: ReturnType<typeof setInterval>;
  private libAt = 0;
  private busy = false;
  constructor(public url: string) {
    const tick = async () => {
      if (this.busy || this.readyState === 2) return;
      this.busy = true;
      try {
        const es: EngineState = await engineCall("/state");
        if (Date.now() - this.libAt > 3000) {
          library = (await engineCall("/library")).songs as LibSong[];
          this.libAt = Date.now();
        }
        const data = JSON.stringify(toReaperState(es, library));
        this.onmessage?.(new MessageEvent("message", { data }));
      } catch (err) {
        const detail = JSON.stringify({ error: err instanceof Error ? err.message : "Speler reageert niet" });
        (this.listeners.get("reaper-error") || []).forEach(cb => cb(new MessageEvent("reaper-error", { data: detail })));
      } finally {
        this.busy = false;
      }
    };
    this.timer = setInterval(tick, 200);
    setTimeout(tick, 0);
  }
  addEventListener(type: string, cb: (e: MessageEvent) => void) { this.listeners.set(type, [...(this.listeners.get(type) || []), cb]); }
  removeEventListener(type: string, cb: (e: MessageEvent) => void) { this.listeners.set(type, (this.listeners.get(type) || []).filter(x => x !== cb)); }
  close() { this.readyState = 2; clearInterval(this.timer); }
}

// ------------------------------------------------------------- the stand-in for POST /api/reaper

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function reaperAction(body: Record<string, any>): Promise<Response> {
  const { action, track, value, final, region, mode, path, pos } = body;
  try {
    switch (action) {
      case "play": await engineCall("/play"); break;
      case "pause": await engineCall("/pause"); break;
      case "stop": await engineCall("/stop"); break;
      case "start": await engineCall("/seek", { t: 0 }); break;
      case "save": break;     // the mix isn't stored per song (yet)
      case "volume": case "mute": case "solo": {
        const ref = trackMap.get(Number(track));
        if (!ref) return json({ error: "Ongeldig tracknummer" }, 400);
        if (action === "volume") {
          const v = Number(value);
          if (!Number.isFinite(v) || v < 0 || v > 4) return json({ error: "Ongeldig volume" }, 400);
          if (ref.kind === "bus") await engineCall("/group", { bus: ref.bus, gain: v });
          else await engineCall("/gain", { stem: ref.name, db: v <= 0 ? -150 : 20 * Math.log10(v) });
        } else if (ref.kind === "bus") {
          await engineCall("/group", { bus: ref.bus, [action]: value === undefined ? 1 : value ? 1 : 0 });
        } else {
          await engineCall(action === "mute" ? "/mute" : "/solo", { stem: ref.name, on: value === undefined ? 1 : value ? 1 : 0 });
        }
        break;
      }
      case "unmuteAll": await engineCall("/unmute"); break;
      case "master": {
        const params: Record<string, unknown> = {};
        if (value !== undefined) params.db = Number(value) <= 0 ? -90 : 20 * Math.log10(Number(value));
        if (body.mute !== undefined) params.mute = body.mute ? 1 : 0;
        await engineCall("/master", params);
        break;
      }
      case "seek": await engineCall("/seek", { t: Number(pos) }); break;
      case "jump": {
        const idx = regionToIndex.get(Number(region));
        if (idx === undefined) return json({ error: "Sectie niet gevonden" }, 400);
        const r = await engineCall("/jump", { id: idx, ...(mode ? { mode } : {}) });
        if (r.error) return json(r, 400);
        break;
      }
      case "mode": await engineCall("/mode", { m: mode }); break;
      case "loop": { const r = await engineCall("/loop", { on: value ? 1 : 0 }); if (r.error) return json(r, 400); break; }
      case "song": {
        if (typeof path !== "string") return json({ error: "Onbekende song" }, 400);
        const r = await engineCall(mode ? "/song" : "/load", { path, ...(mode ? { mode } : {}) });
        if (r.error) return json(r, 400);
        break;
      }
      case "songCancel": await engineCall("/songcancel"); break;
      case "recordStart": await engineCall("/record", { action: "start" }); break;
      case "recordCancel": await engineCall("/record", { action: "cancel" }); break;
      case "tap": await engineCall("/tap", Number.isFinite(Number(pos)) ? { pos: Number(pos) } : {}); break;
      case "recordSave": {
        const r = await engineCall("/record", { action: "save" });
        if (r.error) return json(r, 400);
        const taps = await engineCall("/taps");
        if (!taps.path) return json({ error: "Geen song actief" }, 400);
        if (!Object.keys(taps.sections || {}).length) return json({ success: true, sections: [] });
        const o = await engineCall("/sections", { path: taps.path });
        if (o.error) return json(o, 400);
        const res = await fetch("/api/reaper/arrangement/timing", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "recorded", path: taps.path, sections: o.sections, lead: o.lead, taps: taps.sections }),
        });
        const data = await res.json();
        if (!res.ok || data.error) return json(data, res.status);
        await engineCall("/cues", { path: taps.path, data: data.cues });
        return json({ success: true, sections: data.sections });
      }
      case "pad": {
        // value: { op: "play" | "stop" | "volume", set, layer, key, fade, volume }; the engine plays the pads itself, apart from the songs
        const v = (body.value || {}) as Record<string, unknown>;
        const r = await engineCall("/pad", { op: v.op, set: v.set, layer: v.layer, key: v.key, fade: v.fade, volume: v.volume });
        if (r.error) return json(r, 400);
        break;
      }
      default: return json({ error: "Onbekende actie" }, 400);
    }
    void final;
    return json({ success: true });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 502);
  }
}

// ------------------------------------------------------------- songs from the server

const norm = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
  .replace(/\((feat|ft|with)[^)]*\)/g, " ").replace(/&/g, " and ").replace(/['’`]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
export const sameSong = (a: string, b: string) => { const x = norm(a), y = norm(b); return !!x && (x === y || y.startsWith(x + " ") || x.startsWith(y + " ")); };

export async function serverSongs(): Promise<ServerSong[]> {
  const res = await fetch("/api/tracks/desktop", { cache: "no-store" });
  const json = await res.json();
  if (!res.ok || json.error) throw new Error(json.error || `HTTP ${res.status}`);
  return json.songs;
}
export const fetchJobs = async (): Promise<FetchJob[]> => (await window.arkDesktop!.fetchStatus()).jobs;
export const startFetch = (s: ServerSong) => window.arkDesktop!.fetchSong({ id: s.id, folder: s.folder, title: s.title, rpp: s.rpp });
export const startImport = () => window.arkDesktop!.importZip();
export const removeLocalSong = (folder: string) => window.arkDesktop!.removeSong(folder);
const BUSY = ["wachtrij", "ophalen", "uitpakken", "click"];
export const isFetching = (j: FetchJob) => BUSY.includes(j.state);

const AUTO_KEY = "ark-auto-fetch";
export const autoFetchEnabled = () => (store.get(AUTO_KEY) ?? "1") === "1";
export const setAutoFetch = (v: boolean) => store.set(AUTO_KEY, v ? "1" : "0");

/** Songs on the setlist that are not on this computer yet: fetch them from the server (when automatic fetching is on) */
export async function autoFetchMissing(items: { title: string; path: string | null }[]) {
  if (!hasDesktopEngine() || isOffline() || !autoFetchEnabled()) return;
  const missing = items.filter(i => !i.path);
  if (!missing.length) return;
  try {
    const [songs, jobs] = await Promise.all([serverSongs(), fetchJobs()]);
    for (const m of missing) {
      const song = songs.find(x => sameSong(m.title, x.title));
      if (!song || jobs.some(j => j.id === song.id)) continue;      // not on the server, or already fetched/being fetched (a failed one is retried by hand)
      startFetch(song);
    }
  } catch { /* the list on the screen shows what is missing */ }
}

// ------------------------------------------------------------- own setlist (no service in the web app needed)

const OWN_KEY = "ark-own-setlist";
const SOURCE_KEY = "ark-setlist-source";
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* no memory in a private window */ } },
};

export const getSetlistSource = (): "service" | "own" => (isOffline() || store.get(SOURCE_KEY) === "own" ? "own" : "service");
export const setSetlistSource = (v: "service" | "own") => store.set(SOURCE_KEY, v);
export function ownPaths(): string[] { try { return JSON.parse(store.get(OWN_KEY) || "[]"); } catch { return []; } }
const saveOwn = (list: string[]) => store.set(OWN_KEY, JSON.stringify(list));
export const ownAdd = (path: string) => { const l = ownPaths(); if (!l.includes(path)) saveOwn([...l, path]); };
export const ownRemove = (i: number) => saveOwn(ownPaths().filter((_, k) => k !== i));
export function ownMove(i: number, d: -1 | 1) {
  const l = ownPaths(); const j = i + d;
  if (j < 0 || j >= l.length) return;
  [l[i], l[j]] = [l[j], l[i]];
  saveOwn(l);
}

// Links made by hand between a title of the service list and a song on this computer. They stay on this computer:
// the server's links are for the track computer's songs and would not fit here.
const LINKS_KEY = "ark-song-links";
function ownLinks(): Record<string, string | null> { try { return JSON.parse(store.get(LINKS_KEY) || "{}"); } catch { return {}; } }
function saveOwnLink(title: string, path: string | null) { const l = ownLinks(); l[norm(title)] = path; store.set(LINKS_KEY, JSON.stringify(l)); }
function withOwnLinks<T extends { title: string; path: string | null; manual?: boolean }>(list: T[], lib: LibSong[]): T[] {
  const links = ownLinks();
  return list.map(i => {
    const k = norm(i.title);
    if (!(k in links)) return i;
    const p = links[k];
    if (p === null) return { ...i, path: null, manual: true };                      // "no track" chosen on purpose
    return lib.some(l => l.path === p) ? { ...i, path: p, manual: true } : i;
  });
}

// ------------------------------------------------------------- the stand-in for /api/reaper/setlist

// Marks the songs of a list that are being fetched from the server right now, and starts fetching the missing ones
async function withFetching<T extends { title: string; path: string | null }>(list: T[]): Promise<(T & { fetching?: boolean })[]> {
  let jobs: FetchJob[] = [];
  try { jobs = await fetchJobs(); } catch { /* no fetcher */ }
  autoFetchMissing(list);
  return list.map(i => (i.path ? i : { ...i, fetching: jobs.some(j => isFetching(j) && sameSong(i.title, j.title)) }));
}

async function setlist(realFetch: typeof fetch, init: RequestInit | undefined, url: URL): Promise<Response> {
  const method = (init?.method || "GET").toUpperCase();
  const body = method === "POST" ? JSON.parse(String(init?.body || "{}")) : {};
  const lib: LibSong[] = (await engineCall("/library")).songs;
  library = lib;
  const es: EngineState = await engineCall("/state");
  const songs = lib.map(l => ({ name: l.name, path: l.path }));
  const post = (payload: unknown) => realFetch("/api/reaper/setlist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });

  if (getSetlistSource() === "own") {
    const paths = ownPaths();
    if (method === "GET") {
      const list = paths.map(p => {
        const song = lib.find(l => l.path === p);
        return { id: p, title: song ? parseSongName(song.name).title : p.split("/").pop() || p, artist: "", section: "", path: song ? p : null, manual: true, local: null };
      });
      return json({ today: "", dates: [], date: "own", setlist: await withFetching(list), songs, loaded: es.setlist, bridgeError: null, own: true });
    }
    if (body.action === "load") {
      const have = paths.filter(p => lib.some(l => l.path === p));
      if (!have.length) return json({ error: "Je eigen setlist is nog leeg" }, 400);
      await engineCall("/setlist", { p: have });
      return json({ success: true, loaded: have.length });
    }
  }

  if (method === "GET") {
    const res = await post({ action: "match", date: url.searchParams.get("date"), songs, loaded: es.setlist });
    if (!res.ok) return res;
    const data = await res.json();
    data.setlist = await withFetching(withOwnLinks(data.setlist || [], lib));
    return json(data);
  }
  if (body.action === "load") {
    const r = await post({ action: "match", date: body.date, songs, loaded: [] });
    const data = await r.json();
    const paths: string[] = withOwnLinks(data.setlist || [], lib).map((s: { path: string | null }) => s.path).filter((p: string | null): p is string => !!p);
    if (!paths.length) return json({ error: "Geen songs uit deze setlist gevonden in de map met nummers op deze computer" }, 400);
    await engineCall("/setlist", { p: paths });
    return json({ success: true, loaded: paths.length });
  }
  if (body.action === "link") {
    if (typeof body.title !== "string" || !body.title.trim()) return json({ error: "Titel ontbreekt" }, 400);
    if (body.path !== null && !lib.some(l => l.path === body.path)) return json({ error: "Onbekende song" }, 400);
    saveOwnLink(body.title, body.path);
    return json({ success: true });
  }
  return json({ error: "Onbekende actie" }, 400);
}

// ------------------------------------------------------------- text link and timing (server builds, engine plays)

// The server builds the layout and the cue table; it needs the sections of the song, which the engine
// knows. The cue table that comes back goes to the engine (it writes it next to the song).
async function withSections(realFetch: typeof fetch, url: URL, init: RequestInit | undefined): Promise<Response> {
  const method = (init?.method || "GET").toUpperCase();
  const timing = url.pathname.endsWith("/timing");
  const body: Record<string, any> = method === "POST" ? JSON.parse(String(init?.body || "{}")) : Object.fromEntries(url.searchParams);
  if (method === "GET" && url.searchParams.has("search")) return realFetch(url.pathname + url.search, init);
  const path = String(body.path || "");
  const o = await engineCall("/sections", { path });
  if (o.error) return json(o, 400);
  const payload: Record<string, any> = { ...body, sections: o.sections, lead: o.lead };
  if (method === "GET") payload.action = "read";
  const res = await realFetch(url.pathname, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  if (method === "POST" && res.ok) {
    const data = await res.json();
    if (typeof data.cues === "string") {
      const r = await engineCall("/cues", { path, data: data.cues });
      if (r.error) return json(r, 400);
    }
    void timing;
    return json(data);
  }
  return res;
}

// Without the server there are no settings to ask for: the local engine does it all (FreeShow address: the one it kept)
const OFFLINE_SETTINGS = { userRole: "admin", userPermissions: ["tracks"], reaperEnabled: true, offline: true };

// ------------------------------------------------------------- install

let installed = false;

export function installDesktopAdapter() {
  if (installed || !hasDesktopEngine()) return;
  installed = true;
  const realFetch = window.fetch.bind(window);
  const RealEventSource = window.EventSource;

  window.EventSource = function (url: string | URL, init?: EventSourceInit) {
    return String(url).startsWith("/api/reaper/stream") ? (new LocalEventSource(String(url)) as unknown as EventSource) : new RealEventSource(url, init);
  } as unknown as typeof EventSource;
  Object.assign(window.EventSource, { CONNECTING: 0, OPEN: 1, CLOSED: 2 });

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, window.location.origin);
    const method = (init?.method || "GET").toUpperCase();
    try {
      if (isOffline() && url.pathname.startsWith("/api/") && url.pathname !== "/api/reaper" && url.pathname !== "/api/reaper/setlist") {
        if (url.pathname === "/api/settings") return json(OFFLINE_SETTINGS);
        return json({ error: "Dit kan alleen met een verbinding met de server" }, 503);
      }
      if (url.pathname === "/api/reaper" && method === "POST") return await reaperAction(JSON.parse(String(init?.body || "{}")));
      if (url.pathname === "/api/reaper/setlist") return await setlist(realFetch, init, url);
      if (url.pathname === "/api/reaper/arrangement" || url.pathname === "/api/reaper/arrangement/timing") return await withSections(realFetch, url, init);
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : String(err) }, 502);
    }
    return realFetch(input, init);
  };
}
