import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// Library of uploaded MultiTracks downloads (zip files). The server keeps
// every zip permanently as the backup; the agent on the track computer
// (ark_tracks_agent.py) downloads new ones, converts them to REAPER projects
// and reports back. Uploads arrive in chunks so large files get past reverse
// proxy body limits and can resume after a dropped connection.
//
// Lives in data/tracks, which the config backup skips (zipUtils.ts) - these
// files are gigabytes and are themselves the backup.

export const TRACKS_DIR = path.join(process.cwd(), 'data', 'tracks');
const FILES_DIR = path.join(TRACKS_DIR, 'files');
const INDEX_FILE = path.join(TRACKS_DIR, 'library.json');
const AGENT_FILE = path.join(TRACKS_DIR, 'agent.json');

export const CHUNK_SIZE = 8 * 1024 * 1024;
export const MAX_TRACK_SIZE = 4 * 1024 * 1024 * 1024;

export type TrackStatus = 'uploading' | 'stored' | 'downloading' | 'converting' | 'ready' | 'error' | 'deleted';

export interface TrackReport {
  title?: string;
  rpp?: string;
  dir?: string;
  tempo?: number[];
  stems?: number;
  sections?: string[];
  busses?: Record<string, string[]>;
  missing?: string[];
}

export interface TrackItem {
  id: string;
  fileName: string;
  size: number;
  status: TrackStatus;
  message?: string;
  report?: TrackReport;
  uploadedBy: string;
  uploadedAt: string;
  updatedAt: string;
  // Keep the audio on the track computer even when no setlist needs it
  pinned?: boolean;
  // Reported by the agent: "full" = audio on the track computer, "slim" =
  // only the REAPER project there (audio removed to save space)
  local?: 'full' | 'slim';
}

export interface AgentInfo {
  lastSeen: string;
  host?: string;
  version?: string;
}

function ensureDirs() {
  fs.mkdirSync(FILES_DIR, { recursive: true });
}

function readIndex(): TrackItem[] {
  try {
    return JSON.parse(fs.readFileSync(INDEX_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

// Write-new-then-rename, see the NFS root_squash note: overwriting in place
// can fail on the NAS share, a fresh file plus rename doesn't.
function writeJson(file: string, data: unknown) {
  ensureDirs();
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

// All index changes go through one in-process queue so concurrent requests
// (agent status + a new upload) can't overwrite each other's change.
let indexQueue: Promise<unknown> = Promise.resolve();
function updateIndex<T>(fn: (items: TrackItem[]) => T): Promise<T> {
  const run = async () => {
    const items = readIndex();
    const result = fn(items);
    writeJson(INDEX_FILE, items);
    return result;
  };
  const p = indexQueue.then(run, run);
  indexQueue = p.catch(() => undefined);
  return p;
}

export function listTracks(includeDeleted = false): TrackItem[] {
  const items = readIndex();
  return includeDeleted ? items : items.filter(i => i.status !== 'deleted');
}

export function getTrack(id: string): TrackItem | undefined {
  return readIndex().find(i => i.id === id);
}

export function trackFilePath(id: string): string {
  if (!/^[a-f0-9]{16,64}$/.test(id)) throw new Error('Ongeldig id');
  return path.join(FILES_DIR, `${id}.zip`);
}

export function receivedBytes(id: string): number {
  try {
    return fs.statSync(trackFilePath(id)).size;
  } catch {
    return 0;
  }
}

export function sanitizeFileName(name: string): string {
  const base = path.basename(String(name)).replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_').replace(/^\.+/, '').trim();
  return base || 'track.zip';
}

export async function createUpload(fileName: string, size: number, uploadedBy: string): Promise<TrackItem> {
  const now = new Date().toISOString();
  const item: TrackItem = {
    id: crypto.randomBytes(12).toString('hex'),
    fileName: sanitizeFileName(fileName),
    size,
    status: 'uploading',
    uploadedBy,
    uploadedAt: now,
    updatedAt: now,
  };
  ensureDirs();
  fs.writeFileSync(trackFilePath(item.id), '');
  await updateIndex(items => { items.push(item); });
  return item;
}

// Appends a chunk at exactly the current end of the file, so a retried
// chunk after a timeout can never be written twice.
export function appendChunk(id: string, offset: number, data: Buffer): number {
  const file = trackFilePath(id);
  const current = receivedBytes(id);
  if (offset !== current) {
    const err = new Error(`Verwacht offset ${current}`) as Error & { expected?: number };
    err.expected = current;
    throw err;
  }
  fs.appendFileSync(file, data);
  return current + data.length;
}

export async function completeUpload(id: string): Promise<TrackItem> {
  const item = getTrack(id);
  if (!item) throw new Error('Upload niet gevonden');
  const received = receivedBytes(id);
  if (received !== item.size) throw new Error(`Upload onvolledig (${received} van ${item.size} bytes)`);

  const fd = fs.openSync(trackFilePath(id), 'r');
  const head = Buffer.alloc(4);
  fs.readSync(fd, head, 0, 4, 0);
  fs.closeSync(fd);
  if (head.readUInt32LE(0) !== 0x04034b50) throw new Error('Dit is geen zip-bestand');

  return setTrackStatus(id, { status: 'stored', message: 'Wacht op de track-computer' });
}

export async function setTrackStatus(id: string, patch: Partial<Pick<TrackItem, 'status' | 'message' | 'report' | 'pinned' | 'local'>>): Promise<TrackItem> {
  return updateIndex(items => {
    const item = items.find(i => i.id === id);
    if (!item) throw new Error('Track niet gevonden');
    if (patch.status) item.status = patch.status;
    if (patch.message !== undefined) item.message = patch.message;
    if (patch.report) item.report = patch.report;
    if (patch.pinned !== undefined) item.pinned = patch.pinned;
    if (patch.local) item.local = patch.local;
    item.updatedAt = new Date().toISOString();
    return { ...item };
  });
}

// Removes the server copy; the agent then moves its local copy to
// ~/Tracks/_trash on the track computer.
export async function deleteTrack(id: string): Promise<void> {
  await setTrackStatus(id, { status: 'deleted', message: 'Verwijderd' });
  try {
    fs.unlinkSync(trackFilePath(id));
  } catch {
    // already gone
  }
}

export function getAgentInfo(): AgentInfo | null {
  try {
    return JSON.parse(fs.readFileSync(AGENT_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

export function touchAgent(host?: string, version?: string) {
  writeJson(AGENT_FILE, { lastSeen: new Date().toISOString(), host, version });
}
