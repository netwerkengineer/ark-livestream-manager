// Where the fixtures hang on the stage (for the 2D plan and the 3D view). Stored by the app; the QLC+ workspace only has 2D positions
// that were never filled in. Metres: x = left/right as seen from the audience (0 = middle, negative = left), y = height,
// z = depth (0 = back wall of the stage, positive = towards the audience).
// One fixture in QLC+ can be several physical lamps on the same DMX address: the extra ones are `copies` and show the same light.

import fs from "fs";
import path from "path";
import { readFixtures, type QlcFixture } from "./qlcWorkspace";

const FILE = path.join(process.cwd(), "data", "lights_stage.json");

export type FixtureKind = "par" | "fresnel" | "bar" | "spot" | "kls" | "ubar" | "colorbar";

export interface StageCopy { x: number; y: number; z: number; pan: number; tilt: number; roll: number }

export interface StageFixture {
  id: number;
  x: number; y: number; z: number;
  pan: number;      // degrees around the vertical axis (0 = towards the audience, 90 = to the right, 180 = towards the back wall)
  tilt: number;     // degrees from straight down (0 = down, 90 = horizontal, 180 = straight up)
  roll: number;     // degrees around the beam axis (turns a bar so it lies along the wall instead of across it)
  beam: number;     // beam angle in degrees
  kind: FixtureKind;
  copies: StageCopy[];
}

export interface StageConfig {
  width: number; depth: number; height: number;
  stageDepth: number;   // the stage itself, from the back wall (the rest of the depth is the hall)
  stageWidth: number;
  stageHeight: number;  // the stage is a low platform: lamps standing on it sit that much higher
  fixtures: Record<string, StageFixture>;
}

export function kindOf(f: QlcFixture): FixtureKind {
  const s = `${f.manufacturer} ${f.model} ${f.name}`.toLowerCase();
  if (/fr50|fresnel/.test(s)) return "fresnel";
  if (/kls/.test(s)) return "kls";                         // a bar on a stand with four panels
  if (/ub 9h/.test(s)) return "ubar";                      // the ADJ bar with nine lenses
  if (/lightmaxx|color ?bar/.test(s)) return "colorbar";   // the long bar of small LEDs
  if (/bar/.test(s)) return "bar";
  if (/spot|beam|mover|moving/.test(s)) return "spot";
  return "par";
}

const STAGE_H = 0.4;
const copy = (x: number, y: number, z: number, pan = 0, tilt = 0, roll = 0): StageCopy => ({ x, y, z, pan, tilt, roll });

/** The layout of the church: what hangs or stands where (from the description of the people who set it up) */
function churchLayout(f: QlcFixture, index: number, ofKind: QlcFixture[]): StageFixture | null {
  const s = `${f.manufacturer} ${f.model}`.toLowerCase();
  const n = ofKind.length;
  const i = ofKind.findIndex(x => x.id === f.id);
  const base = { id: f.id, roll: 0, copies: [] as StageCopy[] };
  // ADJ UB 9H: nine bars on the stage floor, pointing up along the walls of the stage (back wash); one DMX address for all nine
  if (/ub 9h/.test(s)) {
    const y = STAGE_H + 0.12;
    const units = [
      ...[-2.8, -1.4, 0, 1.4, 2.8].map(x => copy(x, y, 0.3, 0, 180, 0)),                                // along the back wall
      ...[1.0, 2.2].flatMap(z => [copy(-3.25, y, z, 0, 180, 90), copy(3.25, y, z, 0, 180, 90)]),         // along both sides of the stage
    ];
    const [first, ...rest] = units;
    return { ...base, x: first.x, y: first.y, z: first.z, pan: 0, tilt: 180, roll: 0, beam: 70, kind: "ubar", copies: rest };
  }
  // Chauvet SlimPAR 56: on the stage floor, pointing up: one at the left below the KLS, one under the cross, one at the drums
  if (/slimpar/.test(s)) {
    const spots = [
      { x: -3.0, z: 2.4, pan: 70, tilt: 130 },     // left, below the KLS stand, shining across the stage
      { x: 0.2, z: 0.5, pan: 0, tilt: 180 },       // under the cross, straight up
      { x: 2.7, z: 1.3, pan: 180, tilt: 140 },     // at the drums, up towards the back wall
    ];
    const sp = spots[Math.min(i, spots.length - 1)] || spots[0];
    return { ...base, x: sp.x, y: STAGE_H + 0.1, z: sp.z, pan: sp.pan, tilt: sp.tilt, beam: 25, kind: "par" };
  }
  // Eurolite KLS-200: on a stand in the corners of the stage, the three heads pointing in at the stage
  if (/kls/.test(s)) {
    const left = i % 2 === 0;
    return { ...base, x: left ? -3.2 : 3.2, y: STAGE_H + 1.5, z: left ? 2.8 : 1.0, pan: left ? 112 : -81, tilt: 70, roll: 0, beam: 60, kind: "kls" };
  }
  // ADJ Encor FR50Z fresnels: hanging under the ceiling in front of the stage
  if (/fr50|fresnel/.test(s)) {
    const x = n === 1 ? 0 : -3.6 + (i / (n - 1)) * 7.2;
    return { ...base, x, y: 2.8, z: 4.4, pan: 180, tilt: 35, beam: 40, kind: "fresnel" };
  }
  // lightmaXX colour bars: low along the walls of the hall, two on the left and one on the right
  if (/lightmaxx|color bar/.test(s)) {
    const left = i < 2;
    const z = left ? 6 + i * 3.5 : 7.5;
    return { ...base, x: left ? -4.3 : 4.3, y: 0.3, z, pan: left ? -90 : 90, tilt: 100, roll: 90, beam: 70, kind: "colorbar" };
  }
  void index;
  return null;
}

/** A sensible first layout: the church layout for the lamps we know, the rest on a bar over the stage */
export function defaultStage(fixtures: QlcFixture[]): StageConfig {
  const cfg: StageConfig = { width: 9, depth: 13, height: 3, stageDepth: 3.2, stageWidth: 6.8, stageHeight: STAGE_H, fixtures: {} };
  const groups = new Map<string, QlcFixture[]>();
  for (const f of fixtures) groups.set(`${f.manufacturer} ${f.model}`, [...(groups.get(`${f.manufacturer} ${f.model}`) || []), f]);
  const unknown: QlcFixture[] = [];
  fixtures.forEach((f, index) => {
    const layout = churchLayout(f, index, groups.get(`${f.manufacturer} ${f.model}`) || [f]);
    if (layout) cfg.fixtures[String(f.id)] = layout; else unknown.push(f);
  });
  unknown.forEach((f, i) => {
    const x = unknown.length === 1 ? 0 : -3 + (i / (unknown.length - 1)) * 6;
    cfg.fixtures[String(f.id)] = { id: f.id, x, y: 3.5, z: 2.5, pan: 0, tilt: 30, roll: 0, beam: 30, kind: kindOf(f), copies: [] };
  });
  return cfg;
}

const KINDS: FixtureKind[] = ["par", "fresnel", "bar", "spot", "kls", "ubar", "colorbar"];
const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

/** Saved layout, with defaults for fixtures that are new in the workspace */
export function readStage(): { stage: StageConfig; fixtures: QlcFixture[] } {
  const fixtures = readFixtures();
  const base = defaultStage(fixtures);
  let saved: Partial<StageConfig> = {};
  try { saved = JSON.parse(fs.readFileSync(FILE, "utf-8")); } catch { /* no layout saved yet */ }
  const stage: StageConfig = {
    width: saved.width || base.width, depth: saved.depth || base.depth, height: saved.height || base.height,
    stageDepth: saved.stageDepth ?? base.stageDepth, stageWidth: saved.stageWidth ?? base.stageWidth, stageHeight: saved.stageHeight ?? base.stageHeight,
    fixtures: {},
  };
  for (const f of fixtures) {
    const s = saved.fixtures?.[String(f.id)];
    const merged = { ...base.fixtures[String(f.id)], ...(s || {}), id: f.id, copies: s ? (s.copies || []) : base.fixtures[String(f.id)].copies };
    // a layout saved before the lamps had their own shapes: the generic bar or par becomes the real shape for lamps we know
    if (s && (merged.kind === "bar" || merged.kind === "par") && ["kls", "ubar", "colorbar"].includes(kindOf(f))) merged.kind = kindOf(f);
    stage.fixtures[String(f.id)] = merged;
  }
  return { stage, fixtures };
}

export function saveStage(input: Partial<StageConfig>): StageConfig {
  const { stage } = readStage();
  const next: StageConfig = {
    width: num(input.width, 2, 40, stage.width), depth: num(input.depth, 2, 60, stage.depth), height: num(input.height, 2, 15, stage.height),
    stageDepth: num(input.stageDepth, 0, 60, stage.stageDepth), stageWidth: num(input.stageWidth, 0, 40, stage.stageWidth), stageHeight: num(input.stageHeight, 0, 3, stage.stageHeight),
    fixtures: { ...stage.fixtures },
  };
  for (const [id, f] of Object.entries(input.fixtures || {})) {
    const cur = next.fixtures[id];
    if (!cur) continue;
    next.fixtures[id] = {
      id: cur.id, kind: KINDS.includes(f.kind as FixtureKind) ? f.kind : cur.kind,
      x: num(f.x, -30, 30, cur.x), y: num(f.y, 0, 15, cur.y), z: num(f.z, -2, 60, cur.z),
      pan: num(f.pan, -360, 360, cur.pan), tilt: num(f.tilt, 0, 180, cur.tilt), roll: num(f.roll, -360, 360, cur.roll), beam: num(f.beam, 3, 160, cur.beam),
      copies: Array.isArray(f.copies)
        ? f.copies.slice(0, 40).map(c => ({ x: num(c.x, -30, 30, 0), y: num(c.y, 0, 15, 0), z: num(c.z, -2, 60, 0), pan: num(c.pan, -360, 360, 0), tilt: num(c.tilt, 0, 180, 0), roll: num(c.roll, -360, 360, 0) }))
        : cur.copies,
    };
  }
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(next, null, 1));
  return next;
}
