import { getSettings } from './settingsStore';

// Talks to REAPER's built-in web interface (Settings -> Control/OSC/web ->
// "Web browser interface") on the track computer. Every request is one
// HTTP GET of semicolon-separated commands to /_/, answered with
// tab-separated lines - see reaper_www_root/main.js inside REAPER.app for
// the full command reference.
//
// What the web interface can't do itself (listing songs, opening the
// setlist as project tabs, switching songs, musical section jumps, looping)
// is done by a small Lua script running inside REAPER, the "bridge"
// (ark_tracks_bridge.lua, started from REAPER's Scripts/__startup.lua). The
// two talk through REAPER's ExtState: commands go into ArkTracks/cmd, the
// bridge publishes its state as JSON in ArkTracks/state.

export interface ReaperTrack {
  index: number;       // 0 = master, 1 = first user track
  name: string;
  folder: boolean;
  muted: boolean;
  soloed: boolean;
  volume: number;      // linear, 1 = 0 dB
  meterDb: number;     // current meter level in dB (-150 = silence)
}

// Song sections. mt2reaper writes each section as a region so REAPER can
// jump to one "when the current region finishes" (smooth seek).
export interface ReaperRegion {
  id: number;
  name: string;
  start: number;       // seconds
  end: number;
}

export interface ReaperBus {
  track: ReaperTrack;
  out: number | null;  // hardware output number parsed from "NAME -> Out N"
  label: string;
  stems: ReaperTrack[];
}

export interface BridgeSong {
  name: string;
  path: string;
}

export interface BridgeState {
  songs: BridgeSong[];
  setlist: string[];
  tabs: { name: string; path: string; active: boolean }[];
  mode: JumpMode;
  loop?: number;       // region id being looped
  pending?: number;    // region id a jump is waiting for
  region?: number;     // region id at the play/edit position
  lastCmd: string;
  error?: string;
  outputMode?: string; // chosen output mode
  leadBeats?: number;  // FreeShow slides this many beats early
  freeshow?: string;   // host:port of FreeShow's REST API the cues go to (none = MIDI)
  hasCues?: boolean;   // active song has a FreeShow cue table
  recording?: boolean; // "Timing opnemen" is running
  recSlide?: number;   // while recording: slide (within the section) on screen now
  recSlides?: number;  // ... of this many
  output?: string;     // what's applied now (auto resolves to multi/stereo)
}

export type JumpMode = 'end' | 'bar' | 'now';

// Pad player on the track computer (ArkPads, separate from REAPER so pads
// keep sounding through stop, play and song changes)
export interface PadState {
  playing: boolean;
  set: string;
  layer: string;
  key: string;
  volume: number;
  output: string;
  device: string;
  sets: Record<string, string[]>; // set -> layers
  lastCmd: string;
  error?: string;
}

export interface ReaperState {
  playState: number;   // 0 stopped, 1 playing, 2 paused, 5 recording, 6 record paused
  position: number;    // seconds
  positionBeats: string;
  regions: ReaperRegion[];
  busses: ReaperBus[];
  bridge: BridgeState | null; // null = bridge script not running in REAPER
  pads: PadState | null;      // null = pad player not running
  receivedAt?: number;        // set in the browser: when this state arrived
}

// REAPER command IDs used by the Tracks tab.
export const REAPER_COMMANDS = {
  play: 1007,
  pause: 1008,
  stop: 1016,
  start: 40042, // Transport: Go to start of project
  save: 40026,  // File: Save project
} as const;

const BUS_NAME = /^(.*?)\s*->\s*Out\s*(\d+)\s*$/i;
const BRIDGE = 'ArkTracks';

export async function reaperRequest(commands: string[], timeoutMs = 2000): Promise<string> {
  const settings = getSettings();
  const host = settings.reaperHost || '127.0.0.1';
  const port = settings.reaperPort || 8080;
  const res = await fetch(`http://${host}:${port}/_/${commands.join(';')}`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`REAPER antwoordde met HTTP ${res.status}`);
  return res.text();
}

// GET/EXTSTATE escapes newlines, tabs and backslashes as \n, \t and \\.
function unescapeExtState(value: string): string {
  return value.replace(/\\(.)/g, (_, c) => (c === 'n' ? '\n' : c === 't' ? '\t' : c));
}

function parseBridgeState(raw: string | undefined): BridgeState | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(unescapeExtState(raw));
    return {
      songs: s.songs || [],
      setlist: s.setlist || [],
      tabs: s.tabs || [],
      mode: s.mode || 'end',
      loop: s.loop ?? undefined,
      pending: s.pending ?? undefined,
      region: s.region ?? undefined,
      lastCmd: s.lastCmd || '',
      error: s.error ?? undefined,
      outputMode: s.outputMode ?? undefined,
      leadBeats: typeof s.leadBeats === 'number' ? s.leadBeats : undefined,
      freeshow: s.freeshow ?? undefined,
      hasCues: !!s.hasCues,
      recording: !!s.recording,
      recSlide: s.recSlide ?? undefined,
      recSlides: s.recSlides ?? undefined,
      output: s.output ?? undefined,
    };
  } catch {
    return null;
  }
}

export const STATE_COMMANDS = ['TRANSPORT', 'TRACK', 'REGION', `GET/EXTSTATE/${BRIDGE}/state`, 'GET/EXTSTATE/ArkPads/state'];

// mt2reaper projects put each X32 bus in a folder track named
// "<BUS> -> Out <n>" with its stems underneath. The web interface doesn't
// report folder depth, so a bus is recognised by that name (a bus without
// stems isn't a folder at all) and every following track belongs to it
// until the next bus. Tracks before the first bus (e.g. "FreeShow MIDI")
// carry no audio and are left out.
export function parseReaperState(text: string): ReaperState {
  const state: ReaperState = { playState: 0, position: 0, positionBeats: '', regions: [], busses: [], bridge: null, pads: null };
  let current: ReaperBus | null = null;

  for (const line of text.split('\n')) {
    const f = line.split('\t');
    if (f[0] === 'TRANSPORT') {
      state.playState = parseInt(f[1]) || 0;
      state.position = parseFloat(f[2]) || 0;
      state.positionBeats = f[5] || '';
    } else if (f[0] === 'REGION') {
      state.regions.push({ name: f[1], id: parseInt(f[2]), start: parseFloat(f[3]), end: parseFloat(f[4]) });
    } else if (f[0] === 'EXTSTATE' && f[1] === BRIDGE && f[2] === 'state') {
      state.bridge = parseBridgeState(f.slice(3).join('\t'));
    } else if (f[0] === 'EXTSTATE' && f[1] === 'ArkPads' && f[2] === 'state') {
      try {
        const raw = f.slice(3).join('\t');
        state.pads = raw ? JSON.parse(unescapeExtState(raw)) : null;
      } catch {
        state.pads = null;
      }
    } else if (f[0] === 'TRACK') {
      const flags = parseInt(f[3]) || 0;
      const track: ReaperTrack = {
        index: parseInt(f[1]),
        name: f[2],
        folder: (flags & 1) !== 0,
        muted: (flags & 8) !== 0,
        soloed: (flags & 16) !== 0 || (flags & 32) !== 0,
        volume: parseFloat(f[4]) || 0,
        meterDb: (parseInt(f[7]) || -1500) / 10,
      };
      if (track.index === 0) continue;
      const bus = track.name.match(BUS_NAME);
      if (bus || track.folder) {
        current = {
          track,
          out: bus ? parseInt(bus[2]) : null,
          label: (bus ? bus[1] : track.name).trim(),
          stems: [],
        };
        state.busses.push(current);
      } else if (current) {
        current.stems.push(track);
      }
    }
  }
  return state;
}

export async function getBridgeState(): Promise<BridgeState | null> {
  return parseReaperState(await reaperRequest([`GET/EXTSTATE/${BRIDGE}/state`])).bridge;
}

// The bridge picks up one command per REAPER defer cycle (~30 ms) from a
// single ExtState slot, so commands are sent one at a time and each waits
// until the bridge reports it handled (lastCmd) before the next goes out.
let bridgeQueue: Promise<unknown> = Promise.resolve();
let bridgeSeq = 0;

// REAPER's web interface cuts a request off at about 1000 characters of
// the (URL-encoded) address, so longer commands go in parts that the bridge
// puts back together. Measured on the encoded form: a space, "’" or "@"
// takes 3 to 9 characters there.
const PART_ENCODED = 600;

function splitEncoded(text: string, maxEncoded: number): string[] {
  const parts: string[] = [];
  let current = '';
  let size = 0;
  for (const ch of text) {
    const s = encodeURIComponent(ch).length;
    if (size + s > maxEncoded && current) {
      parts.push(current);
      current = '';
      size = 0;
    }
    current += ch;
    size += s;
  }
  if (current || !parts.length) parts.push(current);
  return parts;
}

async function waitForBridge(id: string, deadline: number) {
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 60));
    // REAPER doesn't answer while it's busy opening projects - keep waiting
    const bridge = await getBridgeState().catch(() => null);
    if (bridge?.lastCmd === id) return bridge;
  }
  throw new Error('REAPER-bridge reageert niet (draait ark_tracks_bridge.lua in REAPER?)');
}

export function sendBridgeCommand(command: string, args: string[] = [], timeoutMs = 3000): Promise<void> {
  const run = async () => {
    const id = `${Date.now().toString(36)}${(bridgeSeq++).toString(36)}`;
    const value = [id, command, ...args].join('\t');
    const deadline = Date.now() + timeoutMs;
    if (encodeURIComponent(value).length > PART_ENCODED) {
      const parts = splitEncoded(value, PART_ENCODED);
      for (let i = 0; i < parts.length - 1; i++) {
        const partId = `${id}.${i + 1}`;
        await reaperRequest([`SET/EXTSTATE/${BRIDGE}/cmd/${encodeURIComponent(`${partId}\t__part\t${i + 1}\t${parts.length}\t${parts[i]}`)}`]);
        await waitForBridge(partId, Date.now() + 3000);
      }
      const last = parts.length;
      await reaperRequest([`SET/EXTSTATE/${BRIDGE}/cmd/${encodeURIComponent(`${id}.${last}\t__part\t${last}\t${last}\t${parts[last - 1]}`)}`]);
    } else {
      await reaperRequest([`SET/EXTSTATE/${BRIDGE}/cmd/${encodeURIComponent(value)}`]);
    }
    const bridge = await waitForBridge(id, deadline);
    if (bridge.error) throw new Error(bridge.error);
  };
  const result = bridgeQueue.then(run, run);
  bridgeQueue = result.catch(() => undefined);
  return result;
}

export interface SongSection {
  id: number;
  name: string;
  start: number;
  finish?: number;
}

// Sections (regions) of a song on the track computer, read by the bridge
// straight from the project file - the song doesn't have to be open.
export async function getSongSections(rppPath: string): Promise<SongSection[]> {
  await sendBridgeCommand('sections', [rppPath], 5000);
  const text = await reaperRequest([`GET/EXTSTATE/${BRIDGE}/sections`]);
  const line = text.split('\n').find(l => l.startsWith('EXTSTATE\t'));
  const data = JSON.parse(unescapeExtState(line?.split('\t').slice(3).join('\t') || '{}'));
  if (data.path !== rppPath) throw new Error('Secties van een andere song ontvangen');
  return data.sections || [];
}

// Taps of a "Timing opnemen" run, per section name: [slide within section, beat].
export async function getRecordedTaps(): Promise<{ path: string; sections: Record<string, [number, number][]> }> {
  const text = await reaperRequest([`GET/EXTSTATE/${BRIDGE}/taps`]);
  const line = text.split('\n').find(l => l.startsWith('EXTSTATE\t'));
  const data = JSON.parse(unescapeExtState(line?.split('\t').slice(3).join('\t') || '{}'));
  return { path: data.path || '', sections: Array.isArray(data.sections) ? {} : (data.sections || {}) };
}

// Command to the pad player; waits until it reports the command handled.
export async function sendPadCommand(command: string, args: string[] = []): Promise<void> {
  const id = `${Date.now().toString(36)}${(bridgeSeq++).toString(36)}`;
  await reaperRequest([`SET/EXTSTATE/ArkPads/cmd/${encodeURIComponent([id, command, ...args].join('\t'))}`]);
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 80));
    const text = await reaperRequest(['GET/EXTSTATE/ArkPads/state']).catch(() => '');
    const pads = parseReaperState(text).pads;
    if (pads?.lastCmd === id) {
      if (pads.error) throw new Error(pads.error);
      return;
    }
  }
  throw new Error('Padspeler reageert niet (draait ArkPads op de track-computer?)');
}
