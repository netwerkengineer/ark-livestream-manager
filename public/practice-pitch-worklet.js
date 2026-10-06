// Pitch shifter for the practice player (Oefenen). When the tempo goes down
// the stems play slower - and lower; this puts the mix back at its own pitch.
//
// WSOLA: the output is built from Hann-windowed grains (50 % overlap) that
// read the input `ratio` times as fast (resampled), so the pitch changes but
// the duration doesn't. Each grain starts where it lines up best with the
// continuation of the previous one (cross-correlation within +-SEARCH), which
// keeps sustained notes free of phasing. The delay is fixed (LATENCY samples,
// enough for the highest ratio), so switching the tempo never runs out of
// input. ratio 1 = grains are exact copies: the input comes out unchanged.

const N = 2048;              // grain length
const H = N / 2;             // hop
const SEARCH = 256;          // alignment search range (samples)
const MAX_RATIO = 2;         // 50 % tempo
const LATENCY = SEARCH + MAX_RATIO * N + 4;
const RING = 1 << 15;        // input history per channel (power of two)
const MASK = RING - 1;
const CORR_STEP = 4;         // correlate every 4th sample
const LAG_STEP = 2;

const WINDOW = new Float32Array(N);
for (let i = 0; i < N; i++) WINDOW[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N); // periodic Hann: sums to 1

class ArkPitchProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: "ratio", defaultValue: 1, minValue: 0.5, maxValue: MAX_RATIO, automationRate: "k-rate" }];
  }

  constructor() {
    super();
    this.ring = [new Float32Array(RING), new Float32Array(RING)];
    this.mono = new Float32Array(RING);
    this.written = 0;                 // input samples written (absolute)
    this.readBase = -LATENCY;         // nominal input position of the next grain
    this.prevStart = null;            // input start of the previous grain
    this.prevRatio = 1;
    this.acc = [new Float32Array(N), new Float32Array(N)];
    this.out = [new Float32Array(H * 4), new Float32Array(H * 4)];
    this.outLen = 0;
    this.target = new Float32Array(Math.ceil(H / CORR_STEP));
    // input -> output delay (about; grains are centred half a hop later)
    this.port.postMessage({ latency: SEARCH + MAX_RATIO * N + H / 2 });
  }

  sample(ch, pos) {
    if (pos < 0 || pos >= this.written - 1) return 0;
    const i = Math.floor(pos);
    const f = pos - i;
    const a = ch[i & MASK];
    return a + (ch[(i + 1) & MASK] - a) * f;
  }

  hop(ratio) {
    let start = this.readBase;
    if (ratio !== 1 && this.prevStart !== null && this.prevRatio === ratio) {
      // Best start: the overlap region should look like the natural
      // continuation of the previous grain
      const t = this.target;
      let tn = 0;
      for (let k = 0, i = 0; i < H; i += CORR_STEP, k++) {
        t[k] = this.sample(this.mono, this.prevStart + (H + i) * ratio);
        tn += t[k] * t[k];
      }
      if (tn > 1e-9) {
        let best = -Infinity;
        let bestLag = 0;
        for (let lag = -SEARCH; lag <= SEARCH; lag += LAG_STEP) {
          const s = this.readBase + lag;
          let c = 0;
          let e = 0;
          for (let k = 0, i = 0; i < H; i += CORR_STEP, k++) {
            const v = this.sample(this.mono, s + i * ratio);
            c += v * t[k];
            e += v * v;
          }
          const score = e > 1e-12 ? c / Math.sqrt(e) : -Infinity;
          if (score > best) { best = score; bestLag = lag; }
        }
        start = this.readBase + bestLag;
      }
    }
    for (let c = 0; c < 2; c++) {
      const acc = this.acc[c];
      const ch = this.ring[c];
      for (let i = 0; i < N; i++) acc[i] += WINDOW[i] * this.sample(ch, start + i * ratio);
      // first half is complete
      this.out[c].set(acc.subarray(0, H), this.outLen);
      acc.copyWithin(0, H);
      acc.fill(0, H);
    }
    this.outLen += H;
    this.prevStart = start;
    this.prevRatio = ratio;
    this.readBase += H;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    const frames = output[0] ? output[0].length : 128;
    const ratio = Math.round(parameters.ratio[0] * 10000) / 10000;

    // store input (mono input = both channels)
    for (let i = 0; i < frames; i++) {
      const l = input[0] ? input[0][i] : 0;
      const r = input[1] ? input[1][i] : l;
      const w = (this.written + i) & MASK;
      this.ring[0][w] = l;
      this.ring[1][w] = r;
      this.mono[w] = l + r;
    }
    this.written += frames;

    while (this.outLen < frames) {
      if (this.readBase + SEARCH + MAX_RATIO * N + 2 > this.written) break;
      this.hop(ratio);
    }
    const n = Math.min(frames, this.outLen);
    for (let c = 0; c < output.length; c++) {
      const src = this.out[Math.min(c, 1)];
      output[c].set(src.subarray(0, n));
      if (n < frames) output[c].fill(0, n);
    }
    for (let c = 0; c < 2; c++) this.out[c].copyWithin(0, n, this.outLen);
    this.outLen -= n;
    return true;
  }
}

registerProcessor("ark-pitch", ArkPitchProcessor);
