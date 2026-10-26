// FreeShow slide markers on the waveform: where each slide of each section appears in the song. Pure functions: the timing data
// (beats from the section start, from /api/reaper/arrangement/timing) and the song's beat times (from the player's /peaks) go in.

import type { TimingSection } from "@/lib/trackTiming";

export const STEP = 0.25;
export const quarter = (x: number) => Math.round(x / STEP) * STEP;

/** Time of quarter note q (fractions allowed, also before the first and after the last beat) from the list of beat times */
export function secOfQn(beats: number[], q: number): number {
  const n = beats.length;
  if (n < 2) return 0;
  const i = Math.min(n - 2, Math.max(0, Math.floor(q)));
  return beats[i] + (q - i) * (beats[i + 1] - beats[i]);
}

/** Quarter note at time t (binary search in the beat times) */
export function qnOfSec(beats: number[], t: number): number {
  const n = beats.length;
  if (n < 2) return 0;
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (beats[mid] <= t) lo = mid; else hi = mid;
  }
  return lo + (t - beats[lo]) / (beats[lo + 1] - beats[lo]);
}

export interface CueMarker {
  key: string;          // section name + slide number
  section: string;      // section name (the timing is kept per section name: every occurrence follows it)
  index: number;        // 1-based slide number within the section
  t: number;            // seconds in the song
  text: string;
  manual: boolean;      // own moment (otherwise the estimate by text length)
  fixed: boolean;       // the first slide: comes by itself before the section, can't be moved
  regionId: number;
  startQn: number;      // quarter note of that occurrence's start (to turn a time back into beats)
}

export interface RegionLite { id: number; name: string; start: number; end: number }

/** All markers of the song: every slide in every occurrence of its section. `edits` holds beats that are being dragged right now. */
export function buildMarkers(
  sections: TimingSection[], regions: RegionLite[], beats: number[], lead: number,
  edits: Record<string, Record<number, number>>,
): CueMarker[] {
  const out: CueMarker[] = [];
  const byName = new Map(sections.map(s => [s.name, s]));
  for (const r of regions) {
    const s = byName.get(r.name);
    if (!s || s.slides.length === 0) continue;
    const startQn = qnOfSec(beats, r.start);
    for (const sl of s.slides) {
      const beat = sl.fixed ? -lead : (edits[s.name]?.[sl.index] ?? sl.beat);
      out.push({
        key: `${s.name}#${sl.index}`, section: s.name, index: sl.index, t: secOfQn(beats, startQn + beat), text: sl.text,
        manual: sl.manual || edits[s.name]?.[sl.index] !== undefined, fixed: sl.fixed, regionId: r.id, startQn,
      });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Beats (from the section start) of the movable slides of a section as they are now, with the edits laid over them */
export function beatsOfSection(s: TimingSection, edits: Record<string, Record<number, number>>): Record<number, number> {
  const own = edits[s.name];
  return Object.fromEntries(s.slides.filter(x => !x.fixed).map(x => [x.index, own?.[x.index] ?? x.beat]));
}

/** Put slide `index` of a section at `target` beats: keeps the order (a quarter beat from its neighbours) and stays inside the section */
export function placeSlide(s: TimingSection, edits: Record<string, Record<number, number>>, index: number, target: number): Record<number, number> {
  const beats = beatsOfSection(s, edits);
  const last = s.slides.length;
  const len = s.lengthQn !== null ? Math.floor(s.lengthQn / STEP) * STEP : 64;
  const lo = (index === 2 ? 0 : beats[index - 1]) + STEP;
  const hi = index === last ? quarter(len - 0.5) : beats[index + 1] - STEP;
  beats[index] = Math.min(Math.max(quarter(target), lo), Math.max(lo, hi));
  return beats;
}
