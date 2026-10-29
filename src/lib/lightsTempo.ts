// Tap tempo for the chases made in the web app: one Virtual Console speed dial ("Tempo") holds every chase that follows the beat, and the
// web app turns the dial through OSC. A step of such a chase lasts one beat (or half or two), so the lights keep time with the music.

import fs from "fs";
import path from "path";
import { sendQlcOsc } from "./qlcControl";

export const TEMPO_PATH = "/ark/light/tempo";
/** The dial runs from 0 to this many milliseconds per beat (30 BPM); OSC gives it a value between 0 and 1 */
export const TEMPO_MAX_MS = 2000;
export const MIN_BPM = 30;
export const MAX_BPM = 240;

/** The channel number QLC+'s OSC plugin gives a path: the CRC-16 (as qChecksum) of the path, which is what the other OSC controls of this workspace use */
export function oscChannel(p: string): number {
  let c = 0xffff;
  for (const b of Buffer.from(p)) {
    c ^= b;
    for (let i = 0; i < 8; i++) c = c & 1 ? (c >> 1) ^ 0x8408 : c >> 1;
  }
  return (c ^ 0xffff) & 0xffff;
}

export interface Tempo { bpm: number; mult: number }
const FILE = path.join(process.cwd(), "data", "lights_tempo.json");
const MULTS = [0.5, 1, 2];

export function readTempo(): Tempo | null {
  try {
    const t = JSON.parse(fs.readFileSync(FILE, "utf-8"));
    return typeof t.bpm === "number" ? { bpm: t.bpm, mult: MULTS.includes(t.mult) ? t.mult : 1 } : null;
  } catch { return null; }
}

/** Milliseconds one step of a chase lasts at this tempo */
export const stepMs = (t: Tempo) => 60000 / t.bpm / t.mult;

export function sendTempo(t: Tempo) {
  sendQlcOsc(TEMPO_PATH, Math.min(1, stepMs(t) / TEMPO_MAX_MS));
}

export function setTempo(input: { bpm?: unknown; mult?: unknown }): Tempo {
  const bpm = Number(input.bpm), mult = Number(input.mult ?? 1);
  if (!Number.isFinite(bpm) || bpm < MIN_BPM || bpm > MAX_BPM) throw new Error(`Het tempo moet tussen ${MIN_BPM} en ${MAX_BPM} BPM liggen`);
  if (!MULTS.includes(mult)) throw new Error("Onbekende verdeling (kies ½, 1 of 2)");
  const t = { bpm: Math.round(bpm * 10) / 10, mult };
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(t));
  sendTempo(t);
  return t;
}
