import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import {
  OWN_DIR, MAX_TRACK_SIZE, trackFilePath, listTracks, getTrack, createOwnItem, setTrackStatus,
} from './trackLibrary';
import {
  validateOwnSong, toSongJson, safeStemFile, AUDIO_EXTENSIONS, type OwnSong,
} from './ownSong';

// Own recordings made with the form: the stems arrive one by one (chunked and
// resumable like a zip upload) into data/tracks/own/<id>; when all are in the
// server writes the song.json, zips everything (store, no recompression) to
// data/tracks/files/<id>.zip and the normal flow takes over (agent, practice
// version).

interface OwnMeta {
  song: OwnSong;                                   // stems carry the safe file names
  files: { name: string; size: number }[];         // same order as song.stems
}

const dirOf = (id: string) => {
  if (!/^[a-f0-9]{16,64}$/.test(id)) throw new Error('Ongeldig id');
  return path.join(OWN_DIR, id);
};
const metaFile = (id: string) => path.join(dirOf(id), 'meta.json');

export function readMeta(id: string): OwnMeta | null {
  try {
    return JSON.parse(fs.readFileSync(metaFile(id), 'utf-8'));
  } catch {
    return null;
  }
}

// Bytes received per file
export function ownReceived(id: string): number[] {
  const meta = readMeta(id);
  if (!meta) return [];
  return meta.files.map(f => {
    try {
      return fs.statSync(path.join(dirOf(id), f.name)).size;
    } catch {
      return 0;
    }
  });
}

export function ownReceivedTotal(id: string): number {
  return ownReceived(id).reduce((a, b) => a + b, 0);
}

export async function createOwn(
  input: OwnSong & { files: { name: string; size: number }[] },
  uploadedBy: string,
): Promise<{ id: string; resumed: boolean }> {
  const { files, ...rest } = input;
  if (!Array.isArray(files) || files.length !== rest.stems?.length) throw new Error('Aantal bestanden klopt niet met de stems');
  const taken = new Set<string>();
  const safe = files.map(f => {
    if (!Number.isInteger(f.size) || f.size <= 0) throw new Error(`Ongeldige grootte voor ${f.name}`);
    return { name: safeStemFile(String(f.name), taken), size: f.size };
  });
  const song: OwnSong = { ...rest, stems: rest.stems.map((s, i) => ({ name: String(s.name), file: safe[i].name })) };
  const errors = validateOwnSong(song);
  if (errors.length) throw new Error(errors.join(' '));
  const total = safe.reduce((a, f) => a + f.size, 0);
  if (total > MAX_TRACK_SIZE) throw new Error('Samen meer dan 4 GB; maak de opnames kleiner (bijv. M4A).');

  // The same recording again after an interrupted upload: carry on
  const same = listTracks().find(i => {
    if (!i.own || i.status !== 'uploading') return false;
    const m = readMeta(i.id);
    return !!m && JSON.stringify({ ...m.song, stems: m.song.stems.map(s => s.file) }) === JSON.stringify({ ...song, stems: song.stems.map(s => s.file) })
      && JSON.stringify(m.files) === JSON.stringify(safe);
  });
  if (same) return { id: same.id, resumed: true };

  const title = song.title.trim().replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ');
  const item = await createOwnItem(`${title}.zip`, total, uploadedBy);
  fs.mkdirSync(dirOf(item.id), { recursive: true });
  for (const f of safe) fs.writeFileSync(path.join(dirOf(item.id), f.name), '');
  fs.writeFileSync(metaFile(item.id), JSON.stringify({ song, files: safe } satisfies OwnMeta));
  return { id: item.id, resumed: false };
}

export function appendOwnChunk(id: string, index: number, offset: number, data: Buffer): number {
  const meta = readMeta(id);
  const file = meta?.files[index];
  if (!meta || !file) throw new Error('Onbekend bestand');
  const target = path.join(dirOf(id), file.name);
  const current = fs.statSync(target).size;
  if (offset !== current) {
    const err = new Error(`Verwacht offset ${current}`) as Error & { expected?: number };
    err.expected = current;
    throw err;
  }
  if (current + data.length > file.size) throw new Error('Meer data dan aangekondigd');
  fs.appendFileSync(target, data);
  return current + data.length;
}

function zipStore(cwd: string, out: string, files: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('nice', ['-n', '10', 'zip', '-0', '-q', '-X', out, ...files], { cwd });
    let stderr = '';
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', code => (code === 0 ? resolve() : reject(new Error(`zip mislukt: ${stderr.trim().slice(-200)}`))));
  });
}

export async function completeOwn(id: string): Promise<void> {
  const item = getTrack(id);
  const meta = readMeta(id);
  if (!item || !item.own || !meta) throw new Error('Opname niet gevonden');
  const received = ownReceived(id);
  const missing = meta.files.filter((f, i) => received[i] !== f.size);
  if (missing.length) throw new Error(`Nog niet alles binnen: ${missing.map(f => f.name).join(', ')}`);
  for (const f of meta.files) {
    if (!AUDIO_EXTENSIONS.some(e => f.name.toLowerCase().endsWith(e))) throw new Error(`${f.name} is geen audiobestand`);
  }

  const dir = dirOf(id);
  fs.writeFileSync(path.join(dir, 'song.json'), JSON.stringify(toSongJson(meta.song), null, 2));
  fs.mkdirSync(path.dirname(trackFilePath(id)), { recursive: true });
  const tmp = `${trackFilePath(id)}.${process.pid}.tmp`;
  try {
    await zipStore(dir, tmp, ['song.json', ...meta.files.map(f => f.name)]);
    fs.renameSync(tmp, trackFilePath(id));
  } finally {
    fs.rmSync(tmp, { force: true });
  }
  const size = fs.statSync(trackFilePath(id)).size;
  fs.rmSync(dir, { recursive: true, force: true });
  await setTrackStatus(id, { status: 'stored', size, message: 'Wacht op de track-computer' });
}

