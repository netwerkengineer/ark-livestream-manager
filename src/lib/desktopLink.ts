import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

// Remote control of the desktop app (Ark Tracks) from the web app (stage view on a tablet or phone).
// The app reports its state to this server and listens here for commands; the server only passes on
// a fixed set of commands, and drops a command that is not carried out in time (a "play" that arrives
// late, after a network hiccup, is worse than a button that did nothing).
// All in memory: after a restart of the server the app just reports in again.

const CONFIG_FILE = path.join(process.cwd(), "data", "desktop-link.json");
export const ONLINE_MS = 8000;        // no report for longer than this = the app is not connected
export const COMMAND_MS = 2500;       // a command that is not carried out within this time is dropped

export type Backend = "reaper" | "desktop";
interface Config { backend: Backend; player: string | null }

export interface RemoteCommand { id: string; kind: "reaper" | "setlist"; body: Record<string, unknown>; by: string; sentAt: number }
interface Pending { resolve: () => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
interface Player {
  id: string; name: string; seenAt: number;
  state: unknown; setlist: unknown;
  listeners: Set<{ fn: (c: RemoteCommand) => void; kinds: Set<string> }>;
  gaps: { t: number; ms: number }[];       // time between two reports of the state (last minute): shows whether the app reports steadily
  pending: Map<string, Pending>;
}
interface Watcher { id: string; user: string; device: string; since: number }

interface Store { players: Map<string, Player>; watchers: Map<string, Watcher>; last: { user: string; device: string; action: string; at: number; ms: number | null } | null; config: Config | null }
const g = globalThis as unknown as { __desktopLink?: Store };
const store: Store = (g.__desktopLink ||= { players: new Map(), watchers: new Map(), last: null, config: null });

// ---- settings of the link (which player the web app controls)
function readConfig(): Config {
  try {
    const j = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    return { backend: j.backend === "desktop" ? "desktop" : "reaper", player: typeof j.player === "string" ? j.player : null };
  } catch {
    return { backend: "reaper", player: null };
  }
}
export function getConfig(): Config { return (store.config ||= readConfig()); }
export function setConfig(patch: Partial<Config>) {
  const next = { ...getConfig(), ...patch };
  store.config = next;
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2));
}
export const isDesktopBackend = () => getConfig().backend === "desktop";

// ---- players (desktop apps that report in)
const cleanName = (s: unknown) => (typeof s === "string" ? s.replace(/[^\w .()-]/g, "").trim().slice(0, 40) : "") || "Desktop-app";
const validId = (s: unknown): s is string => typeof s === "string" && /^[\w-]{8,64}$/.test(s);

/** state: the state of the player (the app reports it itself, twice a second while playing); a report with only a setlist does not count as "seen" */
export function reportState(id: unknown, name: unknown, state: unknown, setlist: unknown): boolean {
  if (!validId(id)) return false;
  let p = store.players.get(id);
  if (!p) { p = { id, name: cleanName(name), seenAt: 0, state: null, setlist: null, listeners: new Set(), pending: new Map(), gaps: [] }; store.players.set(id, p); }
  p.name = cleanName(name);
  if (state && typeof state === "object") {
    const now = Date.now();
    if (p.seenAt) p.gaps.push({ t: now, ms: now - p.seenAt });
    p.gaps = p.gaps.filter(g => now - g.t < 60000);
    p.state = state; p.seenAt = now;
  }
  if (setlist && typeof setlist === "object") p.setlist = setlist;
  return true;
}

const online = (p: Player) => Date.now() - p.seenAt < ONLINE_MS;

/** The player the web app controls now: the chosen one, else the only one that is connected */
export function activePlayer(): Player | null {
  const { player } = getConfig();
  if (player) return store.players.get(player) ?? null;
  const live = [...store.players.values()].filter(online);
  return live.length === 1 ? live[0] : null;
}

export function playerState(): { online: boolean; name: string | null; state: unknown; setlist: unknown } {
  const p = activePlayer();
  return { online: !!p && online(p), name: p?.name ?? null, state: p?.state ?? null, setlist: p?.setlist ?? null };
}

// ---- commands
const REMOTE_ACTIONS = new Set(["play", "pause", "stop", "start", "seek", "jump", "mode", "loop", "song", "songCancel", "volume", "mute", "solo", "unmuteAll", "master", "pad"]);
const PAD_OPS = new Set(["play", "stop", "volume"]);

export function checkCommand(kind: "reaper" | "setlist", body: Record<string, unknown>): string | null {
  const action = body.action;
  if (typeof action !== "string") return "Onbekende actie";
  if (kind === "setlist") return action === "load" && typeof body.date === "string" ? null : "Dit kan niet vanaf afstand";
  if (!REMOTE_ACTIONS.has(action)) return "Deze actie kan niet vanaf afstand";
  if (action === "pad") {
    const v = body.value as { op?: unknown } | undefined;
    if (!v || typeof v.op !== "string" || !PAD_OPS.has(v.op)) return "Onbekende pad-actie";
  }
  return null;
}

/** kinds: which commands this listener carries out (the program does "reaper", the page "setlist") */
export function subscribe(id: string, kinds: string[], fn: (c: RemoteCommand) => void): (() => void) | null {
  const p = store.players.get(id);
  if (!p) return null;
  const l = { fn, kinds: new Set(kinds) };
  p.listeners.add(l);
  return () => { p.listeners.delete(l); };
}

export function sendCommand(kind: "reaper" | "setlist", body: Record<string, unknown>, by: string, device: string): Promise<void> {
  const p = activePlayer();
  const to = p ? [...p.listeners].filter(l => l.kinds.has(kind)) : [];
  if (!p || !online(p) || to.length === 0) return Promise.reject(new Error("De desktop-app is niet verbonden"));
  const cmd: RemoteCommand = { id: randomUUID(), kind, body, by, sentAt: Date.now() };
  store.last = { user: by, device, action: String(body.action), at: cmd.sentAt, ms: null };
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { p.pending.delete(cmd.id); reject(new Error("De desktop-app reageerde niet op tijd (commando niet uitgevoerd)")); }, COMMAND_MS);
    p.pending.set(cmd.id, { resolve: () => { if (store.last?.at === cmd.sentAt) store.last.ms = Date.now() - cmd.sentAt; resolve(); }, reject, timer });
    to.forEach(l => l.fn(cmd));
  });
}

export function ack(playerId: string, id: string, ok: boolean, error?: string) {
  const p = store.players.get(playerId);
  const w = p?.pending.get(id);
  if (!p || !w) return;
  clearTimeout(w.timer);
  p.pending.delete(id);
  if (ok) w.resolve(); else w.reject(new Error(error || "Uitvoeren mislukt"));
}

// ---- who is looking (for the stage view: "2 bedieners")
export function deviceLabel(userAgent: string | null): string {
  const ua = userAgent || "";
  if (/iPad/i.test(ua)) return "iPad";
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? "Android-telefoon" : "Android-tablet";
  if (/Macintosh/i.test(ua)) return "Mac";
  if (/Windows/i.test(ua)) return "Windows";
  return "apparaat";
}
export function watch(user: string, device: string): () => void {
  const id = randomUUID();
  store.watchers.set(id, { id, user, device, since: Date.now() });
  return () => { store.watchers.delete(id); };
}

export function status() {
  const cfg = getConfig();
  const p = activePlayer();
  return {
    backend: cfg.backend,
    chosen: cfg.player,
    player: p ? { id: p.id, name: p.name, online: online(p), seenAgoMs: p.seenAt ? Date.now() - p.seenAt : null, maxGapMs: p.gaps.reduce((m, g) => Math.max(m, g.ms), 0), reports: p.gaps.length } : null,
    players: [...store.players.values()].map(x => ({ id: x.id, name: x.name, online: online(x) })),
    controllers: [...store.watchers.values()].map(w => ({ user: w.user, device: w.device })),
    last: store.last,
  };
}
