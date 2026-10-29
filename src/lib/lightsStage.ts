// Where the fixtures hang on the stage (for the 2D plan and the 3D view). Stored by the app; the QLC+ workspace only has 2D positions
// that were never filled in. Metres: x = left/right (0 = middle), y = height, z = depth (0 = back wall, positive = towards the audience).

import fs from "fs";
import path from "path";
import { readFixtures, type QlcFixture } from "./qlcWorkspace";

const FILE = path.join(process.cwd(), "data", "lights_stage.json");

export type FixtureKind = "par" | "fresnel" | "bar" | "spot";

export interface StageFixture {
  id: number;
  x: number; y: number; z: number;
  pan: number;      // degrees around the vertical axis (0 = towards the audience)
  tilt: number;     // degrees from straight down (0 = down, 90 = horizontal)
  beam: number;     // beam angle in degrees
  kind: FixtureKind;
}

export interface StageConfig {
  width: number; depth: number; height: number;
  fixtures: Record<string, StageFixture>;
}

export function kindOf(f: QlcFixture): FixtureKind {
  const s = `${f.manufacturer} ${f.model}`.toLowerCase();
  if (/fr50|fresnel/.test(s)) return "fresnel";
  if (/bar/.test(s)) return "bar";
  if (/spot|beam|mover|moving/.test(s)) return "spot";
  return "par";
}

/** A sensible first layout: every kind on its own bar, spread evenly over the width */
export function defaultStage(fixtures: QlcFixture[]): StageConfig {
  const cfg: StageConfig = { width: 8, depth: 5, height: 4, fixtures: {} };
  const rows: Record<FixtureKind, { z: number; y: number; tilt: number; pan: number; beam: number }> = {
    fresnel: { z: 1.2, y: 3.6, tilt: 25, pan: 0, beam: 40 },
    par: { z: 2.6, y: 3.6, tilt: 30, pan: 0, beam: 25 },
    bar: { z: 0.5, y: 3.4, tilt: 60, pan: 180, beam: 90 },
    spot: { z: 1.8, y: 3.6, tilt: 20, pan: 0, beam: 18 },
  };
  const byKind = new Map<FixtureKind, QlcFixture[]>();
  for (const f of fixtures) byKind.set(kindOf(f), [...(byKind.get(kindOf(f)) || []), f]);
  for (const [kind, list] of byKind) {
    const r = rows[kind];
    list.forEach((f, i) => {
      const x = list.length === 1 ? 0 : -cfg.width * 0.35 + (i / (list.length - 1)) * cfg.width * 0.7;
      cfg.fixtures[String(f.id)] = { id: f.id, x: Math.round(x * 100) / 100, y: r.y, z: r.z, pan: r.pan, tilt: r.tilt, beam: r.beam, kind };
    });
  }
  return cfg;
}

/** Saved layout, with defaults for fixtures that are new in the workspace */
export function readStage(): { stage: StageConfig; fixtures: QlcFixture[] } {
  const fixtures = readFixtures();
  const base = defaultStage(fixtures);
  let saved: Partial<StageConfig> = {};
  try { saved = JSON.parse(fs.readFileSync(FILE, "utf-8")); } catch { /* no layout saved yet */ }
  const stage: StageConfig = {
    width: saved.width || base.width, depth: saved.depth || base.depth, height: saved.height || base.height,
    fixtures: {},
  };
  for (const f of fixtures) stage.fixtures[String(f.id)] = { ...base.fixtures[String(f.id)], ...(saved.fixtures?.[String(f.id)] || {}), id: f.id };
  return { stage, fixtures };
}

export function saveStage(input: Partial<StageConfig>): StageConfig {
  const { stage } = readStage();
  const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
  const next: StageConfig = {
    width: num(input.width, 2, 40, stage.width), depth: num(input.depth, 2, 40, stage.depth), height: num(input.height, 2, 15, stage.height),
    fixtures: { ...stage.fixtures },
  };
  for (const [id, f] of Object.entries(input.fixtures || {})) {
    const cur = next.fixtures[id];
    if (!cur) continue;
    next.fixtures[id] = {
      id: cur.id, kind: (["par", "fresnel", "bar", "spot"] as const).includes(f.kind as FixtureKind) ? f.kind : cur.kind,
      x: num(f.x, -20, 20, cur.x), y: num(f.y, 0, 15, cur.y), z: num(f.z, -2, 40, cur.z),
      pan: num(f.pan, -360, 360, cur.pan), tilt: num(f.tilt, 0, 180, cur.tilt), beam: num(f.beam, 3, 160, cur.beam),
    };
  }
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(next, null, 1));
  return next;
}
