// Plays a practice version in the browser with the Web Audio API.
//
// The server cut every stem into AAC chunks of `chunk` seconds with a little
// overlap; all stems of one time slice come in one segment file. A scheduler
// puts "pieces" (part of one chunk, all stems) on the audio clock a couple of
// seconds ahead. Every piece fades in and out over `crossfade` seconds and
// the next one starts at the same song time, so consecutive pieces of the
// same audio join without a seam - and a jump or loop is simply a piece that
// ends at the jump moment followed by one that starts at the target.
//
// Only a few chunks around the play position are decoded at a time (a whole
// song with 25 stems decoded would not fit on a phone); the browser keeps the
// downloaded segments in its HTTP cache.

export interface PracticeStem {
  name: string;
  group: string;
  live: boolean;
  muted: boolean;
  channels: number;
}

export interface PracticeSection {
  id: number;
  name: string;
  start: number;
  end: number;
  beat: number;
}

export interface PracticeSegment {
  start: number;
  end: number;
  size: number;
  parts: ([number, number] | null)[];
}

export interface PracticeManifest {
  version: number;
  title: string;
  duration: number;
  sampleRate: number;
  chunk: number;
  crossfade: number;
  groups: string[];
  stems: PracticeStem[];
  segments: PracticeSegment[];
  sections: PracticeSection[];
  tempo: number[][];
  bars: number[];
}

export type JumpMode = "end" | "bar" | "now";

export interface StemMix { volume: number; mute: boolean; solo: boolean }
export interface GroupMix { volume: number; mute: boolean }

interface Piece {
  ctx: number;      // audio clock start
  song: number;     // song time at that moment
  dur: number;      // length without the fade-out tail
  sources: AudioBufferSourceNode[];
  gains: GainNode[];
}

const AHEAD = 2.5;       // seconds scheduled ahead
const TICK_MS = 100;
const START_DELAY = 0.08;

export class UnauthorizedError extends Error {}

export class PracticeEngine {
  readonly m: PracticeManifest;
  private ctx: AudioContext;
  private master: GainNode;
  private groupGain = new Map<string, GainNode>();
  private stemGain: GainNode[] = [];
  private analysers: AnalyserNode[] = [];
  private meterData = new Float32Array(256);

  private shift = 0;                  // AAC decoder delay of this browser (s)
  private decoding = new Map<number, Promise<(AudioBuffer | null)[]>>();
  private ready = new Map<number, (AudioBuffer | null)[]>();
  private pieces: Piece[] = [];
  private cursor: { ctx: number; song: number } | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private pausedAt = 0;

  playing = false;
  buffering = false;
  loop: PracticeSection | null = null;
  pending: { at: number; to: number; section: PracticeSection } | null = null;
  error: string | null = null;
  onChange: () => void = () => {};

  private stems: StemMix[];
  private groups: Record<string, GroupMix>;

  constructor(manifest: PracticeManifest, private segUrl: (n: number) => string, private calUrl: string) {
    this.m = manifest;
    let ctx: AudioContext;
    try {
      ctx = new AudioContext({ sampleRate: manifest.sampleRate, latencyHint: "playback" });
    } catch {
      ctx = new AudioContext();
    }
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    for (const g of manifest.groups) {
      const node = ctx.createGain();
      node.connect(this.master);
      this.groupGain.set(g, node);
    }
    this.stems = manifest.stems.map(s => ({ volume: 1, mute: s.muted, solo: false }));
    this.groups = Object.fromEntries(manifest.groups.map(g => [g, { volume: 1, mute: false }]));
    for (const s of manifest.stems) {
      const gain = ctx.createGain();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      gain.connect(analyser);
      gain.connect(this.groupGain.get(s.group) || this.master);
      this.stemGain.push(gain);
      this.analysers.push(analyser);
    }
    this.applyMix(true);
  }

  // ------------------------------------------------------------- loading

  async init() {
    // iOS: play through the silent switch like a music app
    try {
      const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
      if (session) session.type = "playback";
    } catch {
      // not supported
    }
    try {
      const res = await fetch(this.calUrl, { credentials: "same-origin" });
      if (res.status === 401) throw new UnauthorizedError("Niet ingelogd");
      const buf = await this.ctx.decodeAudioData(await res.arrayBuffer());
      const data = buf.getChannelData(0);
      let peak = 0;
      let at = 0;
      for (let i = 0; i < data.length; i++) {
        const v = Math.abs(data[i]);
        if (v > peak) { peak = v; at = i; }
      }
      const shift = at / buf.sampleRate - 0.5;
      this.shift = Math.abs(shift) < 0.15 ? shift : 0;
    } catch (err) {
      if (err instanceof UnauthorizedError) throw err;
      this.shift = 0;
    }
    await this.chunk(0);
  }

  private async fetchSegment(k: number): Promise<ArrayBuffer> {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(this.segUrl(k), { credentials: "same-origin" });
      if (res.ok) return res.arrayBuffer();
      if (res.status === 401) throw new UnauthorizedError("Niet ingelogd");
      if (attempt >= 2 || res.status === 404) throw new Error(`Laden mislukt (${res.status})`);
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    }
  }

  // Decoded buffers of chunk k (null = silent stem in that chunk)
  private chunk(k: number): Promise<(AudioBuffer | null)[]> {
    let p = this.decoding.get(k);
    if (!p) {
      const seg = this.m.segments[k];
      p = this.fetchSegment(k).then(data =>
        Promise.all(seg.parts.map(part =>
          part ? this.ctx.decodeAudioData(data.slice(part[0], part[0] + part[1])) : Promise.resolve(null),
        )),
      );
      p.then(bufs => this.ready.set(k, bufs)).catch(err => {
        this.decoding.delete(k);
        this.error = err instanceof Error ? err.message : String(err);
        if (err instanceof UnauthorizedError) this.pause();
        this.onChange();
      });
      this.decoding.set(k, p);
    }
    return p;
  }

  private chunkIndex(song: number): number {
    return Math.max(0, Math.min(this.m.segments.length - 1, Math.floor((song + 1e-6) / this.m.chunk)));
  }

  // Keep a window of decoded chunks around the play position
  private prefetch(song: number) {
    const k = this.chunkIndex(song);
    for (let i = k; i <= Math.min(k + 2, this.m.segments.length - 1); i++) this.chunk(i).catch(() => {});
    for (const key of [...this.decoding.keys()]) {
      if (key < k - 1 || key > k + 3) {
        this.decoding.delete(key);
        this.ready.delete(key);
      }
    }
  }

  // ------------------------------------------------------------- scheduling

  private schedulePiece(k: number, bufs: (AudioBuffer | null)[], song: number, end: number, at: number) {
    const seg = this.m.segments[k];
    const xf = this.m.crossfade;
    const dur = end - song;
    const piece: Piece = { ctx: at, song, dur, sources: [], gains: [] };
    bufs.forEach((buf, i) => {
      if (!buf) return;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(1, at + xf);
      g.gain.setValueAtTime(1, at + dur);
      g.gain.linearRampToValueAtTime(0, at + dur + xf);
      src.connect(g).connect(this.stemGain[i]);
      const offset = Math.max(0, song - seg.start + this.shift);
      src.start(at, offset, Math.max(0.001, Math.min(dur + xf, buf.duration - offset)));
      piece.sources.push(src);
      piece.gains.push(g);
    });
    this.pieces.push(piece);
  }

  private tick = () => {
    if (!this.playing || !this.cursor) return;
    const now = this.ctx.currentTime;
    const xf = this.m.crossfade;
    this.pieces = this.pieces.filter(p => p.ctx + p.dur + xf + 0.1 > now);

    while (this.cursor.ctx < now + AHEAD) {
      const song: number = this.cursor.song;
      if (song >= this.m.duration - 0.001) {
        // End of the song (no loop that brings us back)
        if (now >= this.cursor.ctx) {
          this.playing = false;
          this.cursor = null;
          this.pausedAt = 0;
          this.loop = null;
          this.pending = null;
          this.stopTimer();
          this.onChange();
        }
        return;
      }
      const k = this.chunkIndex(song);
      const bufs = this.ready.get(k);
      if (!bufs) {
        this.chunk(k).catch(() => {});
        if (this.cursor.ctx < now + 0.05) {
          // Not loaded in time: wait (a short gap) and carry on from here
          this.cursor.ctx = now + 0.05;
          if (!this.buffering) { this.buffering = true; this.onChange(); }
        }
        return;
      }
      if (this.buffering) { this.buffering = false; this.onChange(); }

      let end = Math.min((k + 1) * this.m.chunk, this.m.duration);
      let next = end;
      let jumped: PracticeSection | null = null;
      if (this.loop && song < this.loop.end - 1e-6 && this.loop.end <= end + 1e-6) {
        end = this.loop.end;
        next = this.loop.start;
      }
      if (this.pending && this.pending.at >= song - 1e-6 && this.pending.at <= end + 1e-6) {
        end = this.pending.at;
        next = this.pending.to;
        jumped = this.pending.section;
      }
      if (end - song > 0.002) {
        this.schedulePiece(k, bufs, song, end, this.cursor.ctx);
        this.cursor = { ctx: this.cursor.ctx + (end - song), song: next };
      } else {
        this.cursor = { ctx: this.cursor.ctx, song: next };
      }
      if (jumped) {
        this.pending = null;
        this.onChange();
      }
      this.prefetch(this.cursor.song);
    }
  };

  // Everything scheduled from audio time t on is dropped; what plays then
  // fades out and the scheduler continues from the song time at t.
  private cutAt(t: number) {
    const xf = this.m.crossfade;
    const song = this.songAt(t);
    const keep: Piece[] = [];
    for (const p of this.pieces) {
      if (p.ctx >= t) {
        p.sources.forEach(s => { try { s.stop(); } catch { /* not started */ } });
        continue;
      }
      if (p.ctx + p.dur > t) {
        p.gains.forEach(g => {
          g.gain.cancelScheduledValues(t);
          g.gain.setValueAtTime(1, t);
          g.gain.linearRampToValueAtTime(0, t + xf);
        });
        p.sources.forEach(s => { try { s.stop(t + xf); } catch { /* ignore */ } });
        p.dur = t - p.ctx;
      }
      keep.push(p);
    }
    this.pieces = keep;
    if (song !== null) this.cursor = { ctx: t, song };
  }

  private songAt(t: number): number | null {
    for (const p of this.pieces) {
      if (t >= p.ctx && t < p.ctx + p.dur) return p.song + (t - p.ctx);
    }
    if (this.cursor && t >= this.cursor.ctx - 1e-6) return this.cursor.song;
    // in the not-yet-filled gap after a piece: the cursor's song time
    return this.cursor ? this.cursor.song : null;
  }

  private reschedule() {
    if (!this.playing) return;
    this.cutAt(this.ctx.currentTime + 0.12);
    this.tick();
  }

  private startTimer() {
    if (!this.timer) this.timer = setInterval(this.tick, TICK_MS);
  }

  private stopTimer() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  // ------------------------------------------------------------- transport

  get position(): number {
    if (!this.playing) return this.pausedAt;
    const t = this.ctx.currentTime - (this.ctx.outputLatency || 0);
    for (const p of this.pieces) {
      if (t >= p.ctx && t < p.ctx + p.dur) return p.song + (t - p.ctx);
    }
    if (this.pieces.length && t < this.pieces[0].ctx) return this.pieces[0].song;
    return this.cursor ? this.cursor.song : this.pausedAt;
  }

  get currentSection(): PracticeSection | null {
    const pos = this.position;
    return this.m.sections.find(s => pos >= s.start && pos < s.end) || null;
  }

  async play() {
    if (this.playing) return;
    if (this.ctx.state !== "running") await this.ctx.resume();
    this.error = null;
    const from = this.pausedAt >= this.m.duration - 0.05 ? 0 : this.pausedAt;
    this.playing = true;
    this.buffering = !this.ready.has(this.chunkIndex(from));
    this.onChange();
    try {
      await this.chunk(this.chunkIndex(from));
    } catch {
      this.playing = false;
      this.buffering = false;
      this.onChange();
      return;
    }
    if (!this.playing) return; // paused while loading
    this.buffering = false;
    this.cursor = { ctx: this.ctx.currentTime + START_DELAY, song: from };
    this.startTimer();
    this.tick();
    this.onChange();
  }

  pause() {
    if (!this.playing) return;
    this.pausedAt = this.position;
    const t = this.ctx.currentTime;
    this.cutAt(t + 0.01);
    this.playing = false;
    this.cursor = null;
    this.pending = null;
    this.stopTimer();
    this.onChange();
  }

  stop() {
    this.pause();
    this.pausedAt = 0;
    this.loop = null;
    this.onChange();
  }

  seek(song: number) {
    const wasPlaying = this.playing;
    if (wasPlaying) this.pause();
    this.pausedAt = Math.max(0, Math.min(song, this.m.duration - 0.01));
    this.prefetch(this.pausedAt);
    if (wasPlaying) this.play();
    this.onChange();
  }

  // Go to a section: stopped = put the position there; playing = at the end
  // of the current section, on the next bar or right away (like Playback).
  jump(section: PracticeSection, mode: JumpMode) {
    if (!this.playing) {
      if (this.loop && this.loop.id !== section.id) this.loop = null;
      this.seek(section.start);
      return;
    }
    const pos = this.songAt(this.ctx.currentTime + 0.12) ?? this.position;
    let at = pos;
    if (mode === "end") {
      const cur = this.m.sections.find(s => pos >= s.start && pos < s.end);
      at = cur ? cur.end : pos;
    } else if (mode === "bar") {
      at = this.m.bars.find(b => b > pos + 0.05) ?? pos;
    }
    if (this.loop && this.loop.id !== section.id) this.loop = null;
    this.pending = { at, to: section.start, section };
    this.prefetch(section.start);
    this.reschedule();
    this.onChange();
  }

  cancelJump() {
    this.pending = null;
    this.reschedule();
    this.onChange();
  }

  setLoop(section: PracticeSection | null) {
    this.loop = section;
    if (section) this.prefetch(section.start);
    this.reschedule();
    this.onChange();
  }

  // ------------------------------------------------------------- mix

  get mix() {
    return { stems: this.stems, groups: this.groups };
  }

  setMix(stems: StemMix[], groups: Record<string, GroupMix>) {
    if (stems.length === this.stems.length) this.stems = stems;
    this.groups = { ...this.groups, ...groups };
    this.applyMix(false);
  }

  setStem(i: number, patch: Partial<StemMix>) {
    this.stems = this.stems.map((s, k) => (k === i ? { ...s, ...patch } : s));
    this.applyMix(false);
  }

  setGroup(name: string, patch: Partial<GroupMix>) {
    this.groups = { ...this.groups, [name]: { ...this.groups[name], ...patch } };
    this.applyMix(false);
  }

  private applyMix(immediate: boolean) {
    const anySolo = this.stems.some(s => s.solo);
    const t = this.ctx.currentTime;
    this.stems.forEach((s, i) => {
      const v = s.mute || (anySolo && !s.solo) ? 0 : s.volume;
      if (immediate) this.stemGain[i].gain.value = v;
      else this.stemGain[i].gain.setTargetAtTime(v, t, 0.015);
    });
    for (const [name, node] of this.groupGain) {
      const g = this.groups[name];
      const v = !g || g.mute ? 0 : g.volume;
      if (immediate) node.gain.value = v;
      else node.gain.setTargetAtTime(v, t, 0.015);
    }
  }

  // Peak level per stem in dB (after its fader)
  meters(): number[] {
    return this.analysers.map(a => {
      a.getFloatTimeDomainData(this.meterData);
      let peak = 0;
      for (let i = 0; i < this.meterData.length; i++) peak = Math.max(peak, Math.abs(this.meterData[i]));
      return peak > 0 ? 20 * Math.log10(peak) : -Infinity;
    });
  }

  async close() {
    this.stopTimer();
    this.playing = false;
    this.pieces.forEach(p => p.sources.forEach(s => { try { s.stop(); } catch { /* ignore */ } }));
    this.pieces = [];
    await this.ctx.close().catch(() => {});
  }
}
