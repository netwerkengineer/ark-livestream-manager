// An own recording (not a MultiTracks download): the app asks for title, key,
// tempo and sections in bars, takes the stems and builds the song.json that
// mt2reaper / tracks_practice.py read (see track-computer/song.example.json).
// Used by the form in the browser and by the server, so both check the same.
// The Python reader stays the final judge; this just keeps typos out.

export const OWN_KEYS = [
  'C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B',
  'Cm', 'C#m', 'Dm', 'Ebm', 'Em', 'Fm', 'F#m', 'Gm', 'G#m', 'Am', 'Bbm', 'Bm',
];
export const OWN_SIGS = ['4/4', '3/4', '6/8', '12/8', '2/4', '5/4', '7/8'];
export const AUDIO_EXTENSIONS = ['.wav', '.m4a', '.aif', '.aiff', '.mp3', '.flac', '.caf'];
export const MAX_OWN_STEMS = 64;

export interface OwnSection { name: string; bar: number }
export interface OwnStem { file: string; name: string }

export interface OwnSong {
  title: string;
  album?: string;
  key: string;
  bpm: number;
  sig: string;                                  // starting time signature
  tempoChanges?: { bar: number; bpm: number }[];
  sigChanges?: { bar: number; sig: string }[];
  sections: OwnSection[];
  stems: OwnStem[];
}

const parseSig = (sig: string): [number, number] => {
  const [n, d] = sig.split('/').map(Number);
  return [n, d];
};

// ------------------------------------------------------------- time

// Quarter notes from the start up to the first beat of `bar` (1 = first bar)
export function barToQn(bar: number, sigs: { bar: number; sig: string }[]): number {
  let qn = 0;
  for (let b = 1; b < bar; b++) {
    const active = [...sigs].filter(s => s.bar <= b).sort((a, c) => c.bar - a.bar)[0];
    const [n, d] = parseSig(active ? active.sig : '4/4');
    qn += (n * 4) / d;
  }
  return qn;
}

// Seconds for a position in quarter notes, with stepwise tempo changes
export function qnToSec(qn: number, tempo: { qn: number; bpm: number }[]): number {
  let sec = 0;
  let prevQn = 0;
  let bpm = tempo[0].bpm;
  for (const t of tempo) {
    if (t.qn >= qn) break;
    sec += ((t.qn - prevQn) * 60) / bpm;
    prevQn = t.qn;
    bpm = t.bpm;
  }
  return sec + ((qn - prevQn) * 60) / bpm;
}

function timeSignatures(song: OwnSong) {
  return [{ bar: 1, sig: song.sig }, ...(song.sigChanges || [])].sort((a, b) => a.bar - b.bar);
}

export function sectionTimes(song: OwnSong): number[] {
  const sigs = timeSignatures(song);
  const tempo = [{ bar: 1, bpm: song.bpm }, ...(song.tempoChanges || [])]
    .sort((a, b) => a.bar - b.bar)
    .map(t => ({ qn: barToQn(t.bar, sigs), bpm: t.bpm }));
  return song.sections.map(s => qnToSec(barToQn(s.bar, sigs), tempo));
}

// ------------------------------------------------------------- stems -> groups
// Same naming rules as busses.example.json (the track computer's busses.json
// has the last word; this only previews)

const PRIORITY: [string, string][] = [['synth fx*', 'PADS / STRINGS / FX'], ['synth bass*', 'BASS'], ['vox fx*', 'BGV / KOOR']];
const GROUPS: { name: string; match: string[] }[] = [
  { name: 'CLICK', match: ['click*', 'metronome*'] },
  { name: 'GUIDE', match: ['guide*', 'cues*'] },
  { name: 'DRUMS / PERC', match: ['drum*', 'perc*', 'loop*'] },
  { name: 'BASS', match: ['bass*', 'synth bass*', 'sub*'] },
  { name: 'KEYS', match: ['keys*', 'piano*', 'organ*', 'synth*', 'rhodes*'] },
  { name: 'GITAREN', match: ['eg*', 'ag*', 'gtr*', 'guitar*'] },
  { name: 'BGV / KOOR', match: ['choir*', 'bgv*', 'vox*', 'vocal*', 'voc*', 'soprano*', 'alto*', 'tenor*', 'bari*', 'gang*'] },
  { name: 'PADS / STRINGS / FX', match: ['pad*', 'string*', 'fx*', 'synth fx*', 'brass*'] },
];
const LIVE = ['drums*', 'bass', 'keys', 'piano 1*', 'eg 1*'];
export const FALLBACK_GROUP = 'PADS / STRINGS / FX';

const glob = (pattern: string, text: string) =>
  new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\?]/g, '\\$&').replace(/\*/g, '.*') + '$').test(text);

export function groupFor(stemName: string): { group: string; live: boolean; fallback: boolean } {
  const s = stemName.toLowerCase().trim();
  const live = LIVE.some(p => glob(p, s));
  for (const [pat, group] of PRIORITY) if (glob(pat, s)) return { group, live, fallback: false };
  for (const g of GROUPS) if (g.match.some(p => glob(p, s))) return { group: g.name, live, fallback: false };
  return { group: FALLBACK_GROUP, live, fallback: true };
}

// ------------------------------------------------------------- file names

export function safeStemFile(name: string, taken: Set<string>): string {
  const base = (name.split(/[\\/]/).pop() || 'stem').replace(/[\x00-\x1f:*?"<>|]+/g, '_').replace(/^\.+/, '').trim() || 'stem';
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot).toLowerCase() : '';
  let candidate = base.toLowerCase() === 'song.json' ? `stem_${base}` : `${stem}${ext}`;
  for (let n = 2; taken.has(candidate.toLowerCase()); n++) candidate = `${stem} (${n})${ext}`;
  taken.add(candidate.toLowerCase());
  return candidate;
}

// ------------------------------------------------------------- validation

export function validateOwnSong(song: OwnSong): string[] {
  const errors: string[] = [];
  const int = (n: unknown) => Number.isInteger(n) && (n as number) >= 1;
  if (!song.title?.trim()) errors.push('Vul een titel in.');
  if (!OWN_KEYS.includes(song.key)) errors.push('Kies de toonsoort.');
  if (!(song.bpm >= 20 && song.bpm <= 400)) errors.push('Het tempo moet tussen 20 en 400 bpm liggen.');
  if (!OWN_SIGS.includes(song.sig)) errors.push('Kies de maatsoort.');

  const changes = (list: { bar: number }[] | undefined, what: string) => {
    const bars = (list || []).map(c => c.bar);
    if (bars.some(b => !int(b) || b < 2)) errors.push(`${what}: een wissel kan vanaf maat 2.`);
    if (new Set(bars).size !== bars.length) errors.push(`${what}: twee wissels in dezelfde maat.`);
  };
  changes(song.tempoChanges, 'Tempowissel');
  changes(song.sigChanges, 'Maatsoortwissel');
  for (const t of song.tempoChanges || []) if (!(t.bpm >= 20 && t.bpm <= 400)) errors.push('Tempowissel: tempo tussen 20 en 400 bpm.');
  for (const s of song.sigChanges || []) if (!OWN_SIGS.includes(s.sig)) errors.push('Maatsoortwissel: ongeldige maatsoort.');

  if (!song.sections?.length) errors.push('Voeg minstens één sectie toe; zonder secties kan er niet gesprongen worden.');
  const bars = (song.sections || []).map(s => s.bar);
  song.sections?.forEach((s, i) => {
    if (!s.name?.trim()) errors.push(`Sectie ${i + 1} heeft geen naam.`);
    if (!int(s.bar)) errors.push(`Sectie "${s.name || i + 1}": maat moet een heel getal vanaf 1 zijn.`);
  });
  const dup = bars.find((b, i) => bars.indexOf(b) !== i);
  if (dup !== undefined) errors.push(`Twee secties beginnen in maat ${dup}.`);

  if (!song.stems?.length) errors.push('Kies de stems (audiobestanden).');
  if ((song.stems?.length || 0) > MAX_OWN_STEMS) errors.push(`Maximaal ${MAX_OWN_STEMS} stems.`);
  const names = new Set<string>();
  for (const s of song.stems || []) {
    const n = s.name?.trim().toLowerCase();
    if (!n) errors.push(`Stem ${s.file} heeft geen naam.`);
    else if (names.has(n)) errors.push(`Twee stems heten "${s.name}".`);
    names.add(n);
    if (!AUDIO_EXTENSIONS.some(e => s.file.toLowerCase().endsWith(e))) errors.push(`${s.file} is geen audiobestand (wav, m4a, aif, mp3, flac).`);
  }
  return errors;
}

// The song.json mt2reaper reads
export function toSongJson(song: OwnSong) {
  const tempo = [{ bar: 1, bpm: song.bpm }, ...(song.tempoChanges || [])].sort((a, b) => a.bar - b.bar);
  const sigs = timeSignatures(song);
  return {
    title: song.title.trim(),
    album: song.album?.trim() || undefined,
    key: song.key,
    ...(tempo.length === 1 ? { bpm: song.bpm } : { tempo: tempo.map(t => [t.bar, t.bpm]) }),
    timesig: sigs.length === 1 ? sigs[0].sig : sigs.map(s => [s.bar, s.sig]),
    sections: [...song.sections].sort((a, b) => a.bar - b.bar).map(s => [s.name.trim(), s.bar]),
    stems: song.stems.map(s => ({ file: s.file, name: s.name.trim() })),
  };
}
