// The colour library of the light editor: named colours to give lamps with one click. Kept in data/lights_colors.json.

import fs from "fs";
import path from "path";

export interface LibColor { id: string; name: string; hex: string }

const FILE = path.join(process.cwd(), "data", "lights_colors.json");

export const DEFAULT_COLORS: LibColor[] = [
  { id: "rood", name: "Rood", hex: "#ff0000" },
  { id: "oranje", name: "Oranje", hex: "#ff6a00" },
  { id: "amber", name: "Amber", hex: "#ffb000" },
  { id: "geel", name: "Geel", hex: "#ffee00" },
  { id: "groen", name: "Groen", hex: "#00ff00" },
  { id: "turkoois", name: "Turkoois", hex: "#00ffc8" },
  { id: "cyaan", name: "Cyaan", hex: "#00ffff" },
  { id: "blauw", name: "Blauw", hex: "#0000ff" },
  { id: "paars", name: "Paars", hex: "#8000ff" },
  { id: "magenta", name: "Magenta", hex: "#ff00ff" },
  { id: "roze", name: "Roze", hex: "#ff4fa0" },
  { id: "warm", name: "Warm wit", hex: "#ffb46b" },
  { id: "wit", name: "Wit", hex: "#ffffff" },
];

export function readColors(): LibColor[] {
  try {
    const list = JSON.parse(fs.readFileSync(FILE, "utf-8"));
    if (Array.isArray(list)) return clean(list);
  } catch { /* no file yet */ }
  return DEFAULT_COLORS;
}

function clean(list: unknown[]): LibColor[] {
  const seen = new Set<string>();
  const out: LibColor[] = [];
  for (const raw of list) {
    const c = raw as Partial<LibColor>;
    const name = typeof c.name === "string" ? c.name.trim().replace(/\s+/g, " ").slice(0, 30) : "";
    const hex = typeof c.hex === "string" && /^#[0-9a-fA-F]{6}$/.test(c.hex) ? c.hex.toLowerCase() : "";
    if (!name || !hex) continue;
    let id = typeof c.id === "string" && /^[\w-]{1,40}$/.test(c.id) ? c.id : `c${Date.now().toString(36)}${out.length}`;
    while (seen.has(id)) id += "x";
    seen.add(id);
    out.push({ id, name, hex });
  }
  return out.slice(0, 60);
}

export function saveColors(list: unknown): LibColor[] {
  if (!Array.isArray(list)) throw new Error("Een lijst met kleuren verwacht");
  const colors = clean(list);
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(colors, null, 1));
  return colors;
}
