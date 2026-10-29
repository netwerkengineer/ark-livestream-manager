// The QLC+ workspace (config/ark_church_lighting.qxw): what the webapp needs to know about the lights. Read only for now.

import fs from "fs";
import path from "path";
import { XMLParser } from "fast-xml-parser";

export const WORKSPACE_FILE = path.join(process.cwd(), "config", "ark_church_lighting.qxw");

export interface QlcFixture {
  id: number;
  name: string;
  manufacturer: string;
  model: string;
  mode: string;
  universe: number;   // 0-based, as in the workspace
  address: number;    // 0-based, as in the workspace (DMX channel 1 = address 0)
  channels: number;
}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", isArray: name => ["Fixture", "Function"].includes(name) });

export function readFixtures(file = WORKSPACE_FILE): QlcFixture[] {
  const xml = fs.readFileSync(file, "utf-8");
  const doc = parser.parse(xml);
  const engine = doc?.Workspace?.Engine;
  const list: Record<string, unknown>[] = engine?.Fixture || [];
  return list.map(f => ({
    id: Number(f.ID),
    name: String(f.Name ?? `Fixture ${f.ID}`),
    manufacturer: String(f.Manufacturer ?? ""),
    model: String(f.Model ?? ""),
    mode: String(f.Mode ?? ""),
    universe: Number(f.Universe ?? 0),
    address: Number(f.Address ?? 0),
    channels: Number(f.Channels ?? 1),
  }));
}
