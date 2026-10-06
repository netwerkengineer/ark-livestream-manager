import fs from 'fs/promises';
import path from 'path';
import { getSettings } from './settingsStore';
import { slideLines, lineText, newSlideId, TRACKS_LAYOUT_NAME } from './slideSplit';
import { getSongSections, sendBridgeCommand } from './reaperControl';

// Links the lyrics of a FreeShow show to the sections (regions) of a REAPER
// track and builds a "Tracks" layout in that show: a blank start slide, then
// per section its lyric groups in arrangement order (repeated sections reuse
// the same slides). The cue table says per section which slide numbers to
// show; the bridge in REAPER sends those to FreeShow while playing.
//
// FreeShow's "select slide by index" counts every slide of the layout,
// child slides included, 1-based through the MIDI velocity - so the numbers
// here follow that same flattened order.

const STORE_FILE = path.join(process.cwd(), 'data', 'trackArrangements.json');
const START_GROUP = 'Start (tracks)';
const BLANK_GROUP = 'Instrumentaal';
const MAX_MIDI_SLIDE = 127;

export interface TrackSection {
  id: number;
  name: string;
  start: number;
  finish?: number;
}

export interface ShowGroup {
  id: string;        // group slide id
  group: string;
  text: string;      // all lines of the group (group slide + children)
  slides: number;    // number of slides (1 + children)
}

// section name -> group slide ids. A section that comes back with other
// lyrics (e.g. a chorus sung differently the 2nd time) can have its own
// entry per occurrence: "<name>#<n>" (n = 1st, 2nd, ... time in the track).
export type SectionMapping = Record<string, string[]>;

export const occurrenceKey = (name: string, n: number) => `${name}#${n}`;

export function idsForOccurrence(mapping: SectionMapping, name: string, n: number): string[] {
  return mapping[occurrenceKey(name, n)] ?? mapping[name] ?? [];
}

// Recorded timing ("Timing opnemen") per section name: the beat (quarter note
// from the section start) at which slide 2, 3, ... of that section appears.
// Only used while the section still has the same number of slides.
export type SectionTimings = Record<string, { count: number; at: Record<string, number> }>;

interface StoredArrangement {
  showFile: string;
  mapping: SectionMapping;
  timings?: SectionTimings;
  cues: string;      // cue table as sent to the bridge
  updatedAt: string;
  updatedBy: string;
}

// ------------------------------------------------------------- store

async function readStore(): Promise<Record<string, StoredArrangement>> {
  try {
    return JSON.parse(await fs.readFile(STORE_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

async function writeStore(store: Record<string, StoredArrangement>) {
  await fs.mkdir(path.dirname(STORE_FILE), { recursive: true });
  const tmp = `${STORE_FILE}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(store, null, 2));
  await fs.rename(tmp, STORE_FILE);
}

export async function getStoredArrangement(rppPath: string): Promise<StoredArrangement | null> {
  return (await readStore())[rppPath] || null;
}

// ------------------------------------------------------------- FreeShow catalogue

function showsDir(): string {
  const dir = getSettings().freeshowPath;
  if (!dir) throw new Error('Geen FreeShow-map ingesteld');
  return path.join(dir, 'Shows');
}

function safeShowFile(file: string): string {
  const base = path.basename(file);
  if (!base.endsWith('.show') || base.startsWith('.')) throw new Error('Ongeldige show');
  return path.join(showsDir(), base);
}

export async function readShow(file: string): Promise<{ id: string; show: any }> {
  const parsed = JSON.parse(await fs.readFile(safeShowFile(file), 'utf-8'));
  return Array.isArray(parsed) ? { id: parsed[0], show: parsed[1] } : { id: '', show: parsed };
}

async function writeShow(file: string, id: string, show: any) {
  const full = safeShowFile(file);
  show.timestamps = { ...(show.timestamps || {}), modified: Date.now() };
  // New file + rename: overwriting in place fails on the NAS share
  const tmp = `${full}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(id ? [id, show] : show));
  await fs.rename(tmp, full);
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Song shows (category "song") whose name matches the query.
export async function searchSongShows(query: string, limit = 30): Promise<{ file: string; name: string }[]> {
  const q = norm(query);
  const files = (await fs.readdir(showsDir())).filter(f => f.endsWith('.show') && !f.startsWith('._'));
  const hits = files.filter(f => !q || norm(f).includes(q)).slice(0, 300);
  const out: { file: string; name: string }[] = [];
  for (const file of hits) {
    try {
      const { show } = await readShow(file);
      if (show.category === 'song') out.push({ file, name: show.name || file.replace(/\.show$/, '') });
    } catch {
      // unreadable show - skip
    }
    if (out.length >= limit) break;
  }
  return out;
}

// The catalogue show for a setlist song: same matching as the project
// generator (file name contains title and artist), songs preferred.
export async function findShowForSong(title: string, artist: string): Promise<string | null> {
  const t = title.toLowerCase();
  const a = artist.toLowerCase();
  const files = (await fs.readdir(showsDir())).filter(f => f.endsWith('.show') && !f.startsWith('._'));
  const candidates = files.filter(f => f.toLowerCase().includes(t) && f.toLowerCase().includes(a));
  for (const file of candidates) {
    try {
      if ((await readShow(file)).show.category === 'song') return file;
    } catch {
      // skip
    }
  }
  return candidates[0] || null;
}

// The lyric groups of a show in the order of its normal (non-Tracks) layout.
export function showGroups(show: any): ShowGroup[] {
  const layouts = Object.entries<any>(show.layouts || {});
  const base = layouts.find(([, l]) => l.name !== TRACKS_LAYOUT_NAME) || layouts[0];
  const seen = new Set<string>();
  const groups: ShowGroup[] = [];
  for (const entry of base?.[1].slides || []) {
    const slide = show.slides?.[entry.id];
    if (!slide || seen.has(entry.id) || slide.group === START_GROUP || slide.group === BLANK_GROUP) continue;
    seen.add(entry.id);
    const children = (slide.children || []).filter((c: string) => show.slides[c]);
    const text = [slide, ...children.map((c: string) => show.slides[c])]
      .flatMap((s: any) => slideLines(s).map(lineText))
      .filter(Boolean)
      .join('\n');
    groups.push({ id: entry.id, group: slide.group || '', text, slides: 1 + children.length });
  }
  return groups;
}

// ------------------------------------------------------------- suggestion

const ALIASES: [RegExp, string][] = [
  [/^(refrein|refrain)/, 'chorus'],
  [/^(couplet|vers)(?!e)/, 'verse'],
  [/^brug/, 'bridge'],
  [/^pre ?(refrein|refrain)/, 'prechorus'],
  [/^pre ?chorus/, 'prechorus'],
  [/^post ?chorus/, 'postchorus'],
];

function sectionKey(name: string): { type: string; num: number | null } {
  let n = norm(name).replace(/\s+/g, ' ');
  for (const [re, to] of ALIASES) n = n.replace(re, to);
  const m = n.match(/^(.*?)\s*(\d+)$/);
  const type = (m ? m[1] : n).replace(/\s+/g, '');
  return { type, num: m ? parseInt(m[2]) : null };
}

const INSTRUMENTAL = /^(count|intro|outro|ending|end$|turnaround|interlude|instrumental|solo|break|vamp)/;

export function isInstrumental(sectionName: string): boolean {
  return INSTRUMENTAL.test(sectionKey(sectionName).type);
}

// Proposes which lyric groups belong to which section. Labelled lyrics are
// matched by name (Verse 2 -> "Verse 2", or the 2nd "Verse" group); without
// labels the sung sections get the lyric blocks in order of first appearance
// and a section that comes back gets the same block again. Instrumental
// sections get no lyrics.
export function suggestMapping(sectionNames: string[], groups: ShowGroup[]): SectionMapping {
  const unique: ShowGroup[] = [];
  const seenText = new Set<string>();
  for (const g of groups) {
    if (seenText.has(g.text)) continue;
    seenText.add(g.text);
    unique.push(g);
  }
  const labelled = new Set(unique.map(g => sectionKey(g.group).type + (sectionKey(g.group).num ?? ''))).size > 1;
  const mapping: SectionMapping = {};
  const used = new Set<string>();
  let next = 0;

  const textKey = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

  for (const name of [...new Set(sectionNames)]) {
    const key = sectionKey(name);
    let ids: string[] = [];
    // Several different versions of a bare-named section (e.g. the first
    // chorus worded differently from the later ones): one per occurrence,
    // in the order they were typed; occurrences past the last version get
    // the last one.
    const versions = labelled && key.num === null && !isInstrumental(name)
      ? groups.filter(g => sectionKey(g.group).type === key.type && sectionKey(g.group).num === null)
      : [];
    if (new Set(versions.map(g => textKey(g.text))).size > 1) {
      const times = sectionNames.filter(n => n === name).length;
      for (let n = 1; n <= times; n++) {
        mapping[occurrenceKey(name, n)] = [versions[Math.min(n, versions.length) - 1].id];
      }
      versions.forEach(g => used.add(g.id));
      mapping[name] = [versions[0].id];
      continue;
    }
    if (labelled) {
      const exact = unique.filter(g => {
        const k = sectionKey(g.group);
        return k.type === key.type && k.num === key.num;
      });
      if (exact.length) {
        // An exact label with several blocks (one group typed as two blocks)
        // keeps them all; different variants under a bare label don't.
        ids = key.num !== null || exact.length === 1 ? exact.map(g => g.id) : [exact[0].id];
      } else {
        const sameType = unique.filter(g => sectionKey(g.group).type === key.type);
        if (sameType.length && key.num !== null) {
          const pick = sameType[key.num - 1];
          ids = pick ? [pick.id] : [];
        } else if (sameType.length && !isInstrumental(name)) {
          // Several variants (e.g. three different choruses): propose the
          // first; more can be added by hand
          ids = [sameType[0].id];
        }
      }
    } else if (!isInstrumental(name)) {
      while (next < unique.length && used.has(unique[next].id)) next++;
      if (next < unique.length) ids = [unique[next++].id];
    }
    ids.forEach(id => used.add(id));
    mapping[name] = ids;
  }
  return mapping;
}

// ------------------------------------------------------------- build

// Text in the cue table: space = +, %XX for the characters that separate
// fields (see ark_tracks_bridge.lua), other characters as they are.
function encodeCueText(text: string): string {
  return text
    .replace(/[\t\r\n]+/g, ' ')
    .replace(/[%+,;#@]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'))
    .replace(/ /g, '+');
}

export interface BuildResult {
  cues: string;
  slides: number;
  warnings: string[];
}

function blankSlide(group: string, color: string, notes: string) {
  return { group, color, settings: {}, notes, items: [] as any[], globalGroup: null };
}

// Recorded moments only count when they make sense: rising and inside the
// section (an earlier recording bug could store them out of order).
function timingValid(timing: { count: number; at: Record<string, number> }): boolean {
  let last = 0;
  for (let k = 2; k <= timing.count; k++) {
    const beat = timing.at[String(k)];
    if (beat === undefined) continue;
    if (beat <= last) return false;
    last = beat;
  }
  return true;
}

// Writes the Tracks layout into the show (and makes it the active layout)
// and returns the cue table for the bridge: "regionId:slide@weight,...;...".
export async function buildTracksLayout(
  showFile: string,
  sections: TrackSection[],
  mapping: SectionMapping,
  timings: SectionTimings = {},
): Promise<BuildResult & { show: any; id: string; slideCounts: Record<string, number> }> {
  const { id, show } = await readShow(showFile);
  show.slides = show.slides || {};
  show.layouts = show.layouts || {};

  const findGroup = (group: string) => Object.keys(show.slides).find(k => show.slides[k].group === group);
  const startId = findGroup(START_GROUP) || newSlideId();
  const blankId = findGroup(BLANK_GROUP) || newSlideId();
  show.slides[startId] = show.slides[startId] || blankSlide(START_GROUP, '#334155', 'Lege startdia voor tracks: hier kunnen licht en visuals aan hangen.');
  show.slides[blankId] = show.slides[blankId] || blankSlide(BLANK_GROUP, '#1e293b', 'Lege dia tijdens instrumentale delen (tracks).');

  const entries: { id: string }[] = [];
  const cueParts: string[] = [];
  const slideCounts: Record<string, number> = {};
  const warnings: string[] = [];
  let index = 0;
  // Slide number + weight (text length, the bridge's first estimate of how
  // long a slide stays) + its first line, which the bridge writes as lyric
  // next to the slide's note in REAPER so the notes can be moved by eye.
  const add = (slideId: string): string[] => {
    entries.push({ id: slideId });
    const slides = [slideId, ...(show.slides[slideId].children || []).filter((c: string) => show.slides[c])];
    return slides.map(id => {
      index++;
      const lines = slideLines(show.slides[id]).map(lineText);
      const chars = lines.join(' ').trim().length;
      const text = encodeCueText((lines.find(l => l.trim()) || '').trim().slice(0, 40));
      return `${index}@${Math.max(4, chars)}${text ? `#${text}` : ''}`;
    });
  };

  const seen: Record<string, number> = {};
  sections.forEach((section, i) => {
    let nums: string[];
    const occurrence = (seen[section.name] = (seen[section.name] || 0) + 1);
    if (i === 0 && isInstrumental(section.name)) {
      nums = add(startId);
    } else {
      const ids = idsForOccurrence(mapping, section.name, occurrence).filter(g => show.slides[g]);
      nums = ids.length ? ids.flatMap(add) : add(blankId);
    }
    slideCounts[section.name] = nums.length;
    const timing = timings[section.name];
    if (timing && timing.count === nums.length && timingValid(timing)) {
      // slide@weight[#text] -> slide@weight@beat[#text]
      nums = nums.map((n, k) => (k > 0 && timing.at[k + 1] !== undefined ? n.replace(/^(\d+@\d+)/, `$1@${timing.at[k + 1]}`) : n));
    }
    cueParts.push(`${section.id}:${nums.join(',')}`);
  });

  if (index > MAX_MIDI_SLIDE) {
    warnings.push(`De Tracks-layout heeft ${index} dia's; MIDI kan alleen dia 1-${MAX_MIDI_SLIDE} kiezen. Dia's daarna worden niet automatisch getoond.`);
  }
  const counts: Record<string, number> = {};
  const unmapped = [...new Set(sections.filter(s => {
    const n = (counts[s.name] = (counts[s.name] || 0) + 1);
    return !isInstrumental(s.name) && !idsForOccurrence(mapping, s.name, n).length;
  }).map(s => s.name))];
  if (unmapped.length) warnings.push(`Zonder tekst: ${unmapped.join(', ')}`);

  const existing = Object.entries<any>(show.layouts).find(([, l]) => l.name === TRACKS_LAYOUT_NAME);
  const layoutId = existing?.[0] || newSlideId();
  show.layouts[layoutId] = {
    name: TRACKS_LAYOUT_NAME,
    notes: 'Gemaakt door de livestream-manager voor nummers met tracks: volgt het arrangement van de track.',
    slides: entries,
  };
  show.settings = { ...(show.settings || {}), activeLayout: layoutId };

  // The show and its Tracks layout go along, so every cue the bridge sends
  // to FreeShow names its song (right lyrics even when songs are skipped or
  // repeated)
  const cues = [...(id ? [`show:${id}@${layoutId}`] : []), ...cueParts].join(';');
  return { id, show, cues, slides: index, warnings, slideCounts };
}

// Taps from "Timing opnemen" (per section name: [slide within section, beat])
// merged into the song's stored timing, then layout + cues rebuilt.
export async function saveRecordedTimings(
  rppPath: string,
  taps: Record<string, [number, number][]>,
  user: string,
): Promise<BuildResult & { sections: string[] }> {
  const stored = await getStoredArrangement(rppPath);
  if (!stored) throw new Error('Koppel eerst de tekst aan de secties (knop "Tekst")');
  const sections = await getSongSections(rppPath);
  const { slideCounts } = await buildTracksLayout(stored.showFile, sections, stored.mapping);
  const timings: SectionTimings = { ...(stored.timings || {}) };
  for (const [name, list] of Object.entries(taps)) {
    const count = slideCounts[name];
    if (!count || !list.length) continue;
    const at = timings[name]?.count === count ? { ...timings[name].at } : {};
    for (const [slide, beat] of list) at[String(slide)] = beat;
    // Always in order: a later slide never before an earlier one
    let prev = 0;
    for (let k = 2; k <= count; k++) {
      const beat = at[String(k)];
      if (beat === undefined) continue;
      if (beat <= prev) at[String(k)] = prev + 0.5;
      prev = at[String(k)];
    }
    timings[name] = { count, at };
  }
  const result = await saveArrangement(rppPath, stored.showFile, sections, stored.mapping, user, timings);
  return { ...result, sections: Object.keys(taps) };
}

// The show was changed outside the app (e.g. slides merged in FreeShow and
// synced back): rebuild the Tracks layout + cues so the slide numbers match
// again. The bridge only rewrites its notes in REAPER when the cue table
// actually changed.
export async function rebuildIfShowChanged(rppPath: string): Promise<boolean> {
  const stored = await getStoredArrangement(rppPath);
  if (!stored) return false;
  let mtime: number;
  try {
    mtime = (await fs.stat(safeShowFile(stored.showFile))).mtimeMs;
  } catch {
    return false;
  }
  // Changed show, or a cue table from before cues named their show
  if (mtime <= new Date(stored.updatedAt).getTime() + 2000 && stored.cues.startsWith('show:')) return false;
  const sections = await getSongSections(rppPath);
  const result = await saveArrangement(rppPath, stored.showFile, sections, stored.mapping, stored.updatedBy);
  if (result.cues !== stored.cues) await sendBridgeCommand('cues', [rppPath, result.cues]);
  return true;
}

// A show was saved under a new name: keep its track links pointing at it.
export async function renameShowInArrangements(oldFile: string, newFile: string) {
  const store = await readStore();
  let changed = false;
  for (const a of Object.values(store)) {
    if (a.showFile === oldFile) { a.showFile = newFile; changed = true; }
  }
  if (changed) await writeStore(store);
}

// After the lyrics of a show changed (split, edited) the slide numbers in its
// Tracks layout shift: rebuild the layout and cue table for every track that
// uses this show. Needs the bridge (sections come from the track computer).
export async function rebuildArrangementsForShow(showFile: string): Promise<{ rebuilt: number; failed: string[] }> {
  const store = await readStore();
  let rebuilt = 0;
  const failed: string[] = [];
  for (const [rppPath, arrangement] of Object.entries(store)) {
    if (arrangement.showFile !== showFile) continue;
    try {
      const sections = await getSongSections(rppPath);
      const result = await saveArrangement(rppPath, showFile, sections, arrangement.mapping, arrangement.updatedBy);
      await sendBridgeCommand('cues', [rppPath, result.cues]);
      rebuilt++;
    } catch (err) {
      failed.push(`${path.basename(rppPath)}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { rebuilt, failed };
}

export async function saveArrangement(
  rppPath: string,
  showFile: string,
  sections: TrackSection[],
  mapping: SectionMapping,
  user: string,
  timings?: SectionTimings,
): Promise<BuildResult> {
  const store = await readStore();
  // Keep the recorded timing unless new timing is given
  const useTimings = timings ?? store[rppPath]?.timings ?? {};
  const built = await buildTracksLayout(showFile, sections, mapping, useTimings);
  await writeShow(showFile, built.id, built.show);
  store[rppPath] = { showFile, mapping, timings: useTimings, cues: built.cues, updatedAt: new Date().toISOString(), updatedBy: user };
  await writeStore(store);
  return { cues: built.cues, slides: built.slides, warnings: built.warnings };
}

// ------------------------------------------------------------- practice player

export interface PracticeSlide {
  t: number;         // seconds into the track
  slide: number;     // slide number in the Tracks layout
  lines: string[];
}

// Tempo map as in the practice manifest: [beat, second, bpm] per change
// (stepwise, like mt2reaper's TempoMap).
type TempoMap = number[][];

function qnToSec(tempo: TempoMap, qn: number): number {
  let cur = tempo[0];
  for (const t of tempo) if (t[0] <= qn) cur = t;
  return cur[1] + (qn - cur[0]) * 60 / cur[2];
}

function secToQn(tempo: TempoMap, sec: number): number {
  let cur = tempo[0];
  for (const t of tempo) if (t[1] <= sec) cur = t;
  return cur[0] + (sec - cur[1]) * cur[2] / 60;
}

// The lyrics timeline of a track for the practice player: the same moments
// the bridge in REAPER starts from (first slide of a section LEAD beats
// early, the rest at the recorded beat or spread by text length), with the
// full text of each slide from the show's Tracks layout. Blocks moved by
// hand in REAPER are not known here.
export async function practiceLyrics(
  rppPath: string,
  sections: { id: number; start: number; end: number }[],
  tempo: TempoMap,
): Promise<PracticeSlide[] | null> {
  const stored = await getStoredArrangement(rppPath);
  if (!stored?.cues || !stored.showFile || !tempo.length) return null;
  const { show } = await readShow(stored.showFile);
  const layout = Object.values<any>(show.layouts || {}).find(l => l.name === TRACKS_LAYOUT_NAME);
  if (!layout) return null;

  // slide number (1-based, child slides counted) -> lines
  const flat: string[][] = [];
  for (const entry of layout.slides || []) {
    const slide = show.slides?.[entry.id];
    if (!slide) continue;
    const ids = [entry.id, ...(slide.children || []).filter((c: string) => show.slides[c])];
    for (const id of ids) flat.push(slideLines(show.slides[id]).map(lineText).filter((l: string) => l.trim()));
  }

  const lead = getSettings().reaperCueLeadBeats ?? 2;
  const byRegion = new Map<number, { n: number; w: number; q?: number }[]>();
  for (const part of stored.cues.split(';')) {
    const m = part.match(/^(\d+):(.*)$/);
    if (!m) continue; // "show:..." line
    byRegion.set(Number(m[1]), m[2].split(',').map(entry => {
      const e = entry.match(/^(\d+)@(\d+(?:\.\d+)?)(?:@(-?\d+(?:\.\d+)?))?/);
      return e ? { n: Number(e[1]), w: Number(e[2]), q: e[3] !== undefined ? Number(e[3]) : undefined } : null;
    }).filter((x): x is { n: number; w: number; q: number | undefined } => !!x));
  }

  const out: PracticeSlide[] = [];
  for (const section of sections) {
    const list = byRegion.get(section.id);
    if (!list?.length) continue;
    const qs = secToQn(tempo, section.start);
    const len = secToQn(tempo, section.end) - qs;
    const total = list.reduce((sum, s) => sum + s.w, 0) || 1;
    let useRecorded = true;
    let last = 0;
    for (const s of list.slice(1)) {
      if (s.q === undefined) continue;
      if (s.q <= last || s.q >= len - 0.25) useRecorded = false;
      last = s.q;
    }
    let acc = 0;
    let prev: number | null = null;
    list.forEach((s, k) => {
      let qn: number;
      if (k === 0) qn = qs - lead;
      else if (s.q !== undefined && useRecorded) qn = qs + s.q;
      else qn = qs + Math.round(acc / total * len) - lead;
      if (prev !== null && qn < prev + 0.25) qn = Math.min(prev + 0.5, qs + len - 0.25);
      prev = qn;
      acc += s.w;
      out.push({ t: qnToSec(tempo, Math.max(0, qn)), slide: s.n, lines: flat[s.n - 1] || [] });
    });
  }
  return out.sort((a, b) => a.t - b.t);
}
