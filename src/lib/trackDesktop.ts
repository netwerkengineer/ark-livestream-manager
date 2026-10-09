import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import type { NextRequest } from 'next/server';
import { isAuthorized } from './authHelper';
import { hasDesktopAccess, DESKTOP_COOKIE } from './desktopAccess';
import { TRACKS_DIR, getTrack, listTracks, trackFilePath, type TrackItem } from './trackLibrary';
import { getStoredArrangement } from './trackArrangement';
import { parseSongName } from '../components/tracks/songName';

// What the desktop app needs to play a song of the library on its own computer: the list of songs, the zip (the
// original stems), a description (stems with start and mute, sections, tempo) that mt2reaper reads from the zip
// without unpacking it, and the cue table of the text link. The app unpacks the zip, puts the description next to
// the stems as ark-player.json and makes its own click.

const CACHE_DIR = path.join(TRACKS_DIR, 'desktop');

/** Logged in with the Tracks permission, and the request comes from the desktop app (with its key, when one is set) */
export async function desktopGuard(req: NextRequest): Promise<{ ok: true; username: string } | { ok: false; status: number; error: string }> {
  const session = await isAuthorized(req, undefined, 'tracks');
  if (!session) return { ok: false, status: 401, error: 'Niet geautoriseerd' };
  if (!hasDesktopAccess(req.headers.get('user-agent'), req.cookies.get(DESKTOP_COOKIE)?.value)) {
    return { ok: false, status: 403, error: 'Alleen voor de desktop-app' };
  }
  return { ok: true, username: session.username };
}

export interface DesktopSong {
  id: string;
  title: string;
  key: string | null;
  bpm: number | null;
  size: number;
  own: boolean;
  rpp: string;          // name of the project (the cue table and the text link are kept under this name)
  folder: string;       // folder name on the desktop computer
  updatedAt: string;
}

const safeName = (s: string) => s.replace(/[\\/:*?"<>|\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim();

function describe(item: TrackItem): DesktopSong {
  const title = item.report?.title || item.fileName.replace(/\.zip$/i, '');
  const parsed = parseSongName(title);
  const rppName = item.report?.rpp ? path.basename(item.report.rpp.replace(/\\/g, '/')) : `${safeName(title)}.RPP`;
  const dir = item.report?.rpp ? path.basename(path.dirname(item.report.rpp.replace(/\\/g, '/'))) : safeName(title);
  return {
    id: item.id, title: parsed.title || title, key: parsed.key || null, bpm: parsed.bpm ? Number(parsed.bpm) : null,
    size: item.size, own: !!item.own, rpp: rppName, folder: dir || safeName(title), updatedAt: item.updatedAt,
  };
}

/** Songs that have their zip complete on the server */
export function desktopSongs(): DesktopSong[] {
  return listTracks()
    .filter(i => ['stored', 'downloading', 'converting', 'ready'].includes(i.status))
    .map(describe)
    .sort((a, b) => a.title.localeCompare(b.title, 'nl'));
}

function runDescribe(item: TrackItem, song: DesktopSong): Promise<Record<string, unknown>> {
  const script = path.join(process.cwd(), 'track-computer', 'mt2reaper.py');
  return new Promise((resolve, reject) => {
    const child = spawn('python3', [script, trackFilePath(item.id), '--describe', '--title', item.report?.title || song.title, '--rpp', song.rpp], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) return reject(new Error(err.trim().split('\n').pop() || 'Beschrijving maken mislukt'));
      try { resolve(JSON.parse(out)); } catch { reject(new Error('Beschrijving is geen JSON')); }
    });
  });
}

/** The description of a song (cached next to the library until the zip changes) */
export async function describeTrack(id: string): Promise<Record<string, unknown>> {
  const item = getTrack(id);
  if (!item || !['stored', 'downloading', 'converting', 'ready'].includes(item.status)) throw new Error('Track niet gevonden');
  const song = describe(item);
  const zip = trackFilePath(id);
  const mtime = fs.statSync(zip).mtimeMs;
  const cacheFile = path.join(CACHE_DIR, `${id}.json`);
  try {
    const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
    if (cached.mtime === mtime && cached.rpp === song.rpp) return cached.data;
  } catch { /* no cache yet */ }
  const data = await runDescribe(item, song);
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const tmp = `${cacheFile}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ mtime, rpp: song.rpp, data }));
  fs.renameSync(tmp, cacheFile);
  return data;
}

/** The cue table (as saved by the text link) of a song, found by the file name of its project */
export async function cuesFor(id: string): Promise<string | null> {
  const item = getTrack(id);
  if (!item) return null;
  const stored = await getStoredArrangement(`/${describe(item).rpp}`);
  return stored?.cues ?? null;
}
