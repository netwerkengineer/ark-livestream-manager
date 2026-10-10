// Remote control of the desktop app via the server: the app reports its state to the server a few times a second
// and listens there for commands from the stage view (tablet, phone). Only when "Afstandsbediening toestaan" is on in the
// app's settings, and not without a connection to the server. Commands are carried out by the same code as the buttons in
// the app itself; a fixed set only (the server checks too).

import { hasDesktopEngine, isOffline, snapshot, playerId } from "./desktopEngine";

const REMOTE_ACTIONS = new Set(["play", "pause", "stop", "start", "seek", "jump", "mode", "loop", "song", "songCancel", "volume", "mute", "solo", "unmuteAll", "master", "pad"]);
const JSON_HEADERS = { "Content-Type": "application/json" };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

interface Command { id: string; kind: "reaper" | "setlist"; body: Record<string, unknown> & { action?: string } }

export function startRemoteLink(): () => void {
  const remote = typeof window !== "undefined" ? window.arkDesktop?.remote : undefined;
  if (!hasDesktopEngine() || isOffline() || !remote?.enabled) return () => undefined;

  const id = playerId();
  const name = remote.name || "Ark Tracks";
  let alive = true;
  let source: EventSource | null = null;
  let poke = false;                 // something changed (a command): report again at once
  let reported = false;

  const post = (path: string, body: unknown) => fetch(path, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) });

  // The state of the player and the commands for it (play, jump, mixer, ...) are handled by the program itself (RemoteReporter.swift): a window in
  // the background or behind other windows is slowed down by macOS, which would make the stage view late or "not connected".
  // The page reports the setlist and loads a service setlist on command (that needs the page's own logic).
  const reportLoop = async () => {
    let failures = 0;
    while (alive) {
      try {
        poke = false;
        const r = await fetch("/api/reaper/setlist", { cache: "no-store" });
        const setlist = r.ok ? await r.json() : null;
        const res = await post("/api/desktop-link/setlist", { player: { id, name }, setlist });
        if (res.status === 401 || res.status === 403) throw new Error("niet ingelogd");
        reported = true; failures = 0;
      } catch {
        failures++;
      }
      // a refused request counts as bad behaviour with the proxy in front of the server: after a failure wait long, and longer each time
      const wait = failures ? Math.min(300000, 30000 * 2 ** Math.min(failures - 1, 4)) : 8000;
      for (let waited = 0; alive && waited < wait && !(poke && !failures && waited >= 2000); waited += 250) await sleep(250);
    }
  };

  const run = async (cmd: Command) => {
    let ok = false, error = "";
    try {
      const action = cmd.body?.action;
      if (cmd.kind === "reaper" ? !(typeof action === "string" && REMOTE_ACTIONS.has(action)) : !(cmd.kind === "setlist" && action === "load")) throw new Error("Deze actie kan niet vanaf afstand");
      await snapshot().catch(() => undefined);      // the screens' track numbers must match the state the stage view saw
      const res = await post(cmd.kind === "setlist" ? "/api/reaper/setlist" : "/api/reaper", cmd.body);
      ok = res.ok;
      if (!ok) error = (await res.json().catch(() => ({}))).error || `HTTP ${res.status}`;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    poke = true;
    post("/api/desktop-link/ack", { player: id, id: cmd.id, ok, error }).catch(() => undefined);
  };

  const listen = async () => {
    let fails = 0;
    while (alive) {
      if (!reported) { await sleep(500); continue; }            // the server knows this app only after the first report
      let opened = false;
      await new Promise<void>(done => {
        const es = new EventSource(`/api/desktop-link/commands?player=${encodeURIComponent(id)}&kinds=setlist`);
        source = es;
        es.onopen = () => { opened = true; };
        es.addEventListener("cmd", e => { try { run(JSON.parse((e as MessageEvent).data)); } catch { /* not a command */ } });
        es.addEventListener("unknown", () => { es.close(); done(); });
        es.onerror = () => { if (es.readyState === EventSource.CLOSED) done(); };
      });
      source?.close();
      // a refused connection counts as bad behaviour with the proxy in front of the server: wait longer after each failure
      fails = opened ? 0 : fails + 1;
      const wait = fails ? Math.min(300000, 15000 * 2 ** Math.min(fails - 1, 4)) : 1500;
      for (let waited = 0; alive && waited < wait; waited += 500) await sleep(500);
    }
  };

  reportLoop();
  listen();
  return () => { alive = false; source?.close(); };
}
