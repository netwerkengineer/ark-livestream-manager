// Timing of the FreeShow slides inside a section, in beats (quarter notes) from the
// section start. Pure functions (no I/O) so the timing screen and its API share
// them: they read the cue table the bridge/player gets (see trackArrangement.ts),
// work out where each slide appears now and check an edit before it is saved.
//
// A section's first slide shows `lead` beats before the section starts (fixed).
// Slide 2, 3, ... appear at their recorded/edited beat, or - without timing - spread
// over the section by text length, the same estimate the bridge makes.

export interface RegionInfo {
  id: number;
  name: string;
  start: number;       // seconds
  finish?: number;
  startQn?: number;    // quarter notes from the song start (from the bridge; optional)
  finishQn?: number;
}

export interface CueSlideInfo {
  slide: number;       // slide number in the Tracks layout
  weight: number;      // text length (for the estimate)
  beat: number | null; // recorded/edited moment, beats from the section start
  text: string;        // first line of the slide
}

export type SectionTimings = Record<string, { count: number; at: Record<string, number> }>;

export interface TimingSlide {
  index: number;       // 1-based number within the section
  slide: number;
  text: string;
  weight: number;
  beat: number;        // where it appears now (beats from the section start; first slide: -lead)
  estimate: number;    // where the estimate would put it
  manual: boolean;     // beat is recorded/edited (not the estimate)
  fixed: boolean;      // the first slide: comes by itself, can't be moved
}

export interface TimingSection {
  name: string;
  times: number;                 // how often the section occurs in the song
  regionIds: number[];
  startSec: number;              // of the first occurrence
  lengthSec: number;
  lengthQn: number | null;       // null = unknown (no tempo information)
  secPerQn: number | null;
  slides: TimingSlide[];         // slides of the first occurrence
  manual: boolean;               // at least one slide has its own moment
  mixedCounts: boolean;          // other occurrences have a different number of slides (they use the estimate)
  instrumental: boolean;         // no lyrics: nothing to time
}

export function decodeCueText(s: string): string {
  const plus = s.replace(/\+/g, ' ');
  try { return decodeURIComponent(plus); } catch { return plus; }
}

/** Cue table as built by buildTracksLayout: "show:id@layout;regionId:slide@weight[@beat][#text],...;..." */
export function parseCues(cues: string): { show?: { id: string; layout?: string }; regions: Map<number, CueSlideInfo[]> } {
  const regions = new Map<number, CueSlideInfo[]>();
  let show: { id: string; layout?: string } | undefined;
  for (const entry of cues.split(';')) {
    const s = entry.match(/^show:(\w+)@?(\w*)$/);
    if (s) { show = { id: s[1], layout: s[2] || undefined }; continue; }
    const r = entry.match(/^(\d+):(.*)$/);
    if (!r) continue;
    const list: CueSlideInfo[] = [];
    for (const token of r[2].split(',')) {
      const t = token.match(/^(\d+)@(\d+)(?:@([\d.]+))?(?:#(.*))?$/);
      if (!t) continue;
      list.push({ slide: Number(t[1]), weight: Math.max(1, Number(t[2])), beat: t[3] !== undefined ? Number(t[3]) : null, text: decodeCueText(t[4] || '') });
    }
    regions.set(Number(r[1]), list);
  }
  return { show, regions };
}

const quarter = (x: number) => Math.round(x * 4) / 4;

/** Where the estimate puts slide k (0-based, k >= 1) of a section with `len` beats */
export function estimateBeat(weights: number[], k: number, len: number, lead: number): number {
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const acc = weights.slice(0, k).reduce((a, b) => a + b, 0);
  return Math.floor((acc / total) * len + 0.5) - lead;
}

const INSTRUMENTAL = /^(count|intro|outro|ending|end$|turnaround|interlude|instrumental|solo|break|vamp)/;

export function timingSections(
  regions: RegionInfo[],
  cueRegions: Map<number, CueSlideInfo[]>,
  lead: number,
  bpmGuess?: number | null,
): TimingSection[] {
  const byName = new Map<string, RegionInfo[]>();
  for (const r of regions) byName.set(r.name, [...(byName.get(r.name) || []), r]);
  const out: TimingSection[] = [];
  for (const [name, list] of byName) {
    const first = list[0];
    const lengthSec = Math.max(0, (first.finish ?? first.start) - first.start);
    let lengthQn: number | null = null;
    if (first.startQn !== undefined && first.finishQn !== undefined && first.finishQn > first.startQn) lengthQn = first.finishQn - first.startQn;
    else if (bpmGuess && bpmGuess > 0 && lengthSec > 0) lengthQn = (lengthSec * bpmGuess) / 60;
    const secPerQn = lengthQn && lengthSec ? lengthSec / lengthQn : null;
    const cues = cueRegions.get(first.id) || [];
    const weights = cues.map(c => c.weight);
    const len = lengthQn ?? 16;
    const slides: TimingSlide[] = cues.map((c, k) => {
      const estimate = k === 0 ? -lead : estimateBeat(weights, k, len, lead);
      const manual = k > 0 && c.beat !== null;
      return { index: k + 1, slide: c.slide, text: c.text, weight: c.weight, estimate, beat: manual ? (c.beat as number) : estimate, manual, fixed: k === 0 };
    });
    const counts = new Set(list.map(r => (cueRegions.get(r.id) || []).length));
    out.push({
      name, times: list.length, regionIds: list.map(r => r.id), startSec: first.start, lengthSec, lengthQn, secPerQn, slides,
      manual: slides.some(s => s.manual), mixedCounts: counts.size > 1,
      instrumental: INSTRUMENTAL.test(name.toLowerCase().replace(/^\W+/, '')),
    });
  }
  return out;
}

/** Check an edit ("at": slide number within the section -> beat) and round it to quarter beats */
export function validateTiming(count: number, lengthQn: number | null, at: Record<string, number>): { at: Record<string, number> } | { error: string } {
  const clean: Record<string, number> = {};
  let last = 0;
  for (let k = 2; k <= count; k++) {
    const raw = at[String(k)];
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return { error: `Dia ${k} van de sectie heeft geen moment` };
    const beat = quarter(raw);
    if (beat < 0.25) return { error: `Dia ${k} komt te vroeg (minimaal 1/4 tel na het begin)` };
    if (beat <= last) return { error: `Dia ${k} moet later komen dan dia ${k - 1}` };
    if (lengthQn !== null && beat > lengthQn - 0.5) return { error: `Dia ${k} valt buiten de sectie (de sectie is ${Math.round(lengthQn * 4) / 4} tellen)` };
    clean[String(k)] = beat;
    last = beat;
  }
  return { at: clean };
}
