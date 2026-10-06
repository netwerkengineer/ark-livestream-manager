import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { TRACKS_DIR, listTracks, trackFilePath, type TrackItem } from './trackLibrary';

// Practice versions of the uploaded MultiTracks downloads, for the "Oefenen"
// player: band members play the stems in their own browser at home (nothing
// to do with REAPER on the track computer). tracks_practice.py turns a zip
// into AAC chunks per 10 s (all stems of one time slice in one segment file),
// a calibration file and a manifest with sections, tempo and bars.
//
// One conversion at a time in this process; state in data/tracks/practice.json
// (separate from library.json so the agent logic never sees it).

export const PRACTICE_VERSION = 1; // = VERSION in tracks_practice.py
const PRACTICE_DIR = path.join(TRACKS_DIR, 'practice');
const STATE_FILE = path.join(TRACKS_DIR, 'practice.json');

export type PracticeStatus = 'queued' | 'processing' | 'ready' | 'error';

export interface PracticeState {
  status: PracticeStatus;
  message?: string;
  version?: number;
  bytes?: number;
  builtAt?: string;
}

function readState(): Record<string, PracticeState> {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

// New file + rename (NAS share, see trackLibrary.ts)
function writeState(state: Record<string, PracticeState>) {
  fs.mkdirSync(TRACKS_DIR, { recursive: true });
  const tmp = `${STATE_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, STATE_FILE);
}

function patchState(id: string, patch: PracticeState | null) {
  const state = readState();
  if (patch) state[id] = patch;
  else delete state[id];
  writeState(state);
}

export function practiceState(id: string): PracticeState | null {
  return readState()[id] || null;
}

export function practiceDir(id: string): string {
  if (!/^[a-f0-9]{16,64}$/.test(id)) throw new Error('Ongeldig id');
  return path.join(PRACTICE_DIR, id);
}

// ------------------------------------------------------------- queue

const queue: string[] = [];
let running: string | null = null;

function runNext() {
  if (running || !queue.length) return;
  const id = queue.shift()!;
  running = id;
  patchState(id, { status: 'processing', message: 'Uitpakken' });

  const script = path.join(process.cwd(), 'tracks_practice.py');
  const child = spawn('python3', [script, trackFilePath(id), practiceDir(id)], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  let result: { stems?: number; bytes?: number } = {};
  let buffered = '';
  child.stdout.on('data', (data: Buffer) => {
    buffered += data.toString();
    const lines = buffered.split('\n');
    buffered = lines.pop() || '';
    for (const line of lines) {
      try {
        const msg = JSON.parse(line);
        if (msg.step === 'encode') {
          patchState(id, { status: 'processing', message: `Stem ${msg.done + 1} van ${msg.total}` });
        } else if (msg.step === 'done') {
          result = msg;
        }
      } catch {
        // not a progress line
      }
    }
  });
  child.stderr.on('data', (data: Buffer) => {
    stderr = (stderr + data.toString()).slice(-2000);
  });
  child.on('close', code => {
    if (code === 0) {
      patchState(id, {
        status: 'ready',
        version: PRACTICE_VERSION,
        bytes: result.bytes,
        builtAt: new Date().toISOString(),
      });
    } else {
      const last = stderr.trim().split('\n').pop() || `exit ${code}`;
      console.error(`[practice] ${id} mislukt:`, stderr);
      patchState(id, { status: 'error', message: last.slice(0, 200) });
    }
    running = null;
    runNext();
  });
  child.on('error', err => {
    patchState(id, { status: 'error', message: err.message });
    running = null;
    runNext();
  });
}

export function enqueuePractice(id: string) {
  if (running === id || queue.includes(id)) return;
  queue.push(id);
  patchState(id, { status: 'queued', message: 'In de wachtrij' });
  runNext();
}

// Uploaded songs without a (current) practice version get one; an
// interrupted conversion (server restart) starts again. Errors stay until
// someone asks for a rebuild.
let checked = false;
export function ensurePracticeVersions(items: TrackItem[] = listTracks()) {
  const state = readState();
  const busy = new Set([running, ...queue]);
  for (const item of items) {
    if (item.status === 'uploading' || item.status === 'deleted') continue;
    const s = state[item.id];
    if (busy.has(item.id)) continue;
    const stale = !s
      || (s.status === 'ready' && (s.version || 0) < PRACTICE_VERSION)
      || (!checked && (s.status === 'queued' || s.status === 'processing'));
    if (stale && fs.existsSync(trackFilePath(item.id))) enqueuePractice(item.id);
  }
  // Practice versions of deleted songs go too
  const live = new Set(items.map(i => i.id));
  for (const id of Object.keys(state)) {
    if (live.has(id) || busy.has(id)) continue;
    fs.rmSync(practiceDir(id), { recursive: true, force: true });
    patchState(id, null);
  }
  checked = true;
}
