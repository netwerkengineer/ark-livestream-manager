// The QLC+ fixture library (every lamp QLC+ knows, with its modes and channels), as a compact index in config/qlc-fixtures.json.gz
// (made from the fixtures folder of the QLC+ container).

import fs from "fs";
import path from "path";
import zlib from "zlib";

export interface LibChannel { 0: string; 1: string; 2: string; 3: string }   // [name, group, colour, preset]
export interface LibMode { n: string; c: [string, string, string, string][] }
export interface LibFixture { m: string; d: string; t: string; f: string; modes: LibMode[] }

let cache: LibFixture[] | null = null;

export function library(): LibFixture[] {
  if (!cache) {
    const file = path.join(path.dirname(process.env.QLC_WORKSPACE_FILE || path.join(process.cwd(), "config", "x")), "qlc-fixtures.json.gz");
    cache = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString("utf-8"));
  }
  return cache as LibFixture[];
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function searchLibrary(query: string, limit = 40): { m: string; d: string; t: string; modes: { n: string; channels: number }[] }[] {
  const words = norm(query).split(" ").filter(Boolean);
  const out = [];
  const seen = new Set<string>();
  for (const f of library()) {
    if (seen.has(`${f.m}|${f.d}`)) continue;   // a lamp can be in the library twice (the church's own copy next to the standard one)
    seen.add(`${f.m}|${f.d}`);
    const hay = norm(`${f.m} ${f.d}`);
    if (words.every(w => hay.includes(w))) {
      out.push({ m: f.m, d: f.d, t: f.t, modes: f.modes.map(x => ({ n: x.n, channels: x.c.length })) });
      if (out.length >= limit) break;
    }
  }
  return out;
}

export function findFixture(manufacturer: string, model: string): LibFixture | undefined {
  return library().find(f => f.m === manufacturer && f.d === model);
}
