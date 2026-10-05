import fs from 'fs';
import path from 'path';
import { foldDiacritics } from './freeshowUtils';
import type { BridgeSong } from './reaperControl';

// Matches the songs of a service setlist (titles from the liturgy mail or
// typed by a worship leader) to REAPER projects on the track computer.
// MultiTracks names its downloads "<Title>-<Album>-<Key>-<Tempo>bpm", so a
// project matches when its name starts with the (normalised) title. A
// manual choice in the Tracks tab is remembered per title and always wins,
// so a song only has to be linked by hand once.

const DATA_DIR = path.join(process.cwd(), 'data');
const MAP_FILE = path.join(DATA_DIR, 'trackSongMap.json');

type SongMap = Record<string, string | null>; // normalised title -> project path (null = deliberately none)

export function normalizeTitle(value: string): string {
  return foldDiacritics(value)
    .toLowerCase()
    .replace(/\((feat|ft|with)[^)]*\)/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function readMap(): SongMap {
  try {
    return JSON.parse(fs.readFileSync(MAP_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

export function saveSongLink(title: string, projectPath: string | null) {
  const map = readMap();
  map[normalizeTitle(title)] = projectPath;
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(MAP_FILE, JSON.stringify(map, null, 2));
}

export interface SongMatch {
  path: string | null;
  manual: boolean;
}

export function matchSong(title: string, songs: BridgeSong[]): SongMatch {
  const key = normalizeTitle(title);
  const map = readMap();
  if (key in map) {
    const linked = map[key];
    // A remembered link to a project that no longer exists falls back to
    // automatic matching instead of silently showing nothing.
    if (linked === null || songs.some(s => s.path === linked)) {
      return { path: linked, manual: true };
    }
  }
  if (!key) return { path: null, manual: false };

  const candidates = songs.filter(s => {
    const name = normalizeTitle(s.name);
    return name === key || name.startsWith(key + ' ');
  });
  // Prefer the closest name, e.g. "Way Maker" over "Way Maker Live"
  candidates.sort((a, b) => a.name.length - b.name.length);
  return { path: candidates[0]?.path ?? null, manual: false };
}
