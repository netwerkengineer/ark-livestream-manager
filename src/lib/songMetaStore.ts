import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');
const STORE_FILE = path.join(DATA_DIR, 'songMeta.json');

export interface SongMeta {
  chordsText?: string;
  chordsFileName?: string; // original filename of an uploaded chord chart (txt/pdf)
  chordsFilePath?: string; // where that upload lives on disk - attached verbatim rather than retyped
  youtubeUrl?: string;
  updatedAt: string;
}

// Deliberately a separate store of our own rather than piggybacking on the
// FreeShow .show file's "meta" field: FreeShow's own import converters
// (ChordPro, OpenSong, EasyWorship, ...) replace a show's meta object
// wholesale, which would silently wipe chords/a youtube link stored there.
// Keeping this app-owned means it survives anything FreeShow itself does to
// its files, and leaves room to grow (more fields, history, ...) without
// touching FreeShow's format at all.
type StoreShape = Record<string, SongMeta>;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readStore(): StoreShape {
  if (fs.existsSync(STORE_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(STORE_FILE, 'utf-8'));
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (e) {
      console.error('[SongMeta] Kon opslagbestand niet lezen, start leeg:', e);
    }
  }
  return {};
}

function writeStore(store: StoreShape) {
  ensureDataDir();
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2));
  try {
    fs.chmodSync(STORE_FILE, 0o666);
  } catch (e) {
    // best-effort, matches the cross-container permission pattern used
    // elsewhere in this app (e.g. contactsStore.ts) - not fatal if it fails
  }
}

// Same identity convention the rest of the app already uses for songs
// (checkLocalSongExists, dedupeSongTitle, ...): match by title+artist text
// rather than a FreeShow-internal show id, since callers throughout the
// setlist/email flow only ever have the title/artist to go on.
export function songKey(title: string, artist?: string): string {
  return `${title.trim().toLowerCase()}|${(artist || '').trim().toLowerCase()}`;
}

export function getSongMeta(title: string, artist?: string): SongMeta | null {
  const store = readStore();
  return store[songKey(title, artist)] || null;
}

export function setSongMeta(
  title: string,
  artist: string | undefined,
  patch: { chordsText?: string; chordsFileName?: string; chordsFilePath?: string; youtubeUrl?: string }
): SongMeta {
  const store = readStore();
  const key = songKey(title, artist);
  const existing = store[key] || {};
  const next: SongMeta = { ...existing, updatedAt: new Date().toISOString() };

  if (patch.chordsText !== undefined) {
    if (patch.chordsText.trim()) next.chordsText = patch.chordsText; else delete next.chordsText;
  }
  if (patch.chordsFilePath !== undefined) {
    // An uploaded chord chart replaces free-text chords as the "current"
    // chords for this song (whichever was set most recently wins) - the two
    // aren't meant to coexist as separate things for the same song.
    if (patch.chordsFilePath) {
      next.chordsFilePath = patch.chordsFilePath;
      next.chordsFileName = patch.chordsFileName;
      delete next.chordsText;
    } else {
      delete next.chordsFilePath;
      delete next.chordsFileName;
    }
  }
  if (patch.youtubeUrl !== undefined) {
    if (patch.youtubeUrl.trim()) next.youtubeUrl = patch.youtubeUrl; else delete next.youtubeUrl;
  }

  // Nothing left worth keeping - drop the entry entirely rather than
  // leaving an empty stub behind.
  if (!next.chordsText && !next.chordsFilePath && !next.youtubeUrl) {
    delete store[key];
  } else {
    store[key] = next;
  }
  writeStore(store);
  return next;
}
