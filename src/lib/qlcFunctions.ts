// Scenes and chasers of the QLC+ workspace: read them, change them and put them back. The workspace file is edited as text (only the
// <Function> blocks that change), so everything else in it - fixtures, universes, the Virtual Console - stays exactly as QLC+ wrote it.
// After a change QLC+ has to load the file again (reloadQlc); a copy of the previous file is kept in config/backups.

import fs from "fs";
import path from "path";
import { WORKSPACE_FILE, readFixtures } from "./qlcWorkspace";

export interface SceneFn { id: number; type: "Scene"; name: string; path: string; values: Record<number, number[]> }
export interface ChaserStep { scene: number; fadeIn: number; hold: number; fadeOut: number }
export interface ChaserFn {
  id: number; type: "Chaser"; name: string; path: string;
  direction: "Forward" | "Backward"; runOrder: "Loop" | "SingleShot" | "PingPong" | "Random";
  steps: ChaserStep[];
}
export interface OtherFn { id: number; type: string; name: string; path: string }
export type QlcFunction = SceneFn | ChaserFn | OtherFn;

const BACKUP_DIR = path.join(path.dirname(WORKSPACE_FILE), "backups");
export const RUNTIME_DIR = path.join(path.dirname(WORKSPACE_FILE), "qlcplus", "runtime");

const unescapeXml = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const escapeXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const attr = (tag: string, name: string) => { const m = new RegExp(`${name}="([^"]*)"`).exec(tag); return m ? unescapeXml(m[1]) : ""; };

/** The part of the file with the engine's functions: top level <Function ID=".." Type=".."> blocks (the Virtual Console only has short <Function ID=".." /> references) */
const BLOCK = /<Function ID="(\d+)" Type="(\w+)"[^>]*>[\s\S]*?<\/Function>/g;

export function readFunctions(file = WORKSPACE_FILE): QlcFunction[] {
  const xml = fs.readFileSync(file, "utf-8");
  const eng = xml.slice(xml.indexOf("<Engine>"), xml.indexOf("</Engine>"));
  const out: QlcFunction[] = [];
  for (const m of eng.matchAll(BLOCK)) {
    const block = m[0];
    const head = block.slice(0, block.indexOf(">") + 1);
    const id = Number(m[1]), type = m[2], name = attr(head, "Name"), pth = attr(head, "Path");
    if (type === "Scene") {
      const values: Record<number, number[]> = {};
      for (const v of block.matchAll(/<FixtureVal ID="(\d+)">([^<]*)<\/FixtureVal>/g)) {
        const nums = v[2].split(",").map(Number);
        const arr: number[] = [];
        for (let i = 0; i + 1 < nums.length; i += 2) arr[nums[i]] = nums[i + 1];
        values[Number(v[1])] = Array.from(arr, x => x ?? 0);
      }
      out.push({ id, type: "Scene", name, path: pth, values });
    } else if (type === "Chaser") {
      const steps: ChaserStep[] = [];
      for (const s of block.matchAll(/<Step Number="(\d+)" FadeIn="(\d+)" Hold="(\d+)" FadeOut="(\d+)">(\d+)<\/Step>/g)) {
        steps[Number(s[1])] = { scene: Number(s[5]), fadeIn: Number(s[2]), hold: Number(s[3]), fadeOut: Number(s[4]) };
      }
      const dir = /<Direction>(\w+)<\/Direction>/.exec(block)?.[1];
      const run = /<RunOrder>(\w+)<\/RunOrder>/.exec(block)?.[1];
      out.push({
        id, type: "Chaser", name, path: pth, steps: steps.filter(Boolean),
        direction: dir === "Backward" ? "Backward" : "Forward",
        runOrder: (["Loop", "SingleShot", "PingPong", "Random"] as const).find(r => r === run) || "Loop",
      });
    } else out.push({ id, type, name, path: pth });
  }
  return out;
}

const nextId = (xml: string): number => {
  let max = -1;
  for (const m of xml.matchAll(/<Function ID="(\d+)"/g)) max = Math.max(max, Number(m[1]));
  return max + 1;
};

function backup(file: string) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  fs.copyFileSync(file, path.join(BACKUP_DIR, `ark_church_lighting.${stamp}.qxw`));
  const old = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith(".qxw")).sort();
  for (const f of old.slice(0, Math.max(0, old.length - 30))) fs.unlinkSync(path.join(BACKUP_DIR, f));   // keep the last 30
}

/** The file is written in place (not replaced): the QLC+ container has this single file mounted */
function writeWorkspace(file: string, xml: string) {
  backup(file);
  fs.writeFileSync(file, xml);
}

const int = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.round(Math.min(hi, Math.max(lo, v))) : d);
const cleanName = (v: unknown) => {
  const s = typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "";
  if (!s || s.length > 80) throw new Error("De naam moet tussen 1 en 80 tekens zijn");
  return s;
};

function replaceOrAppend(xml: string, id: number | undefined, block: string): { xml: string; id: number } {
  if (id !== undefined) {
    const re = new RegExp(`[ \\t]*<Function ID="${id}" Type="\\w+"[^>]*>[\\s\\S]*?</Function>`);
    const eng = xml.slice(xml.indexOf("<Engine>"), xml.indexOf("</Engine>"));
    if (!re.test(eng)) throw new Error(`Functie ${id} bestaat niet`);
    const start = xml.indexOf("<Engine>");
    const replaced = eng.replace(re, block.replace(/\$/g, "$$$$"));
    return { xml: xml.slice(0, start) + replaced + xml.slice(xml.indexOf("</Engine>")), id };
  }
  const newId = nextId(xml);
  const withId = block.replace("ID=\"__ID__\"", `ID="${newId}"`);
  const end = xml.indexOf("</Engine>");
  const eng = xml.slice(0, end);
  const lastFn = eng.lastIndexOf("</Function>");
  if (lastFn < 0) throw new Error("Geen functies in het werkbestand");
  const at = lastFn + "</Function>".length;
  return { xml: xml.slice(0, at) + "\n" + withId + xml.slice(at), id: newId };
}

export function saveScene(input: { id?: number; name?: unknown; path?: unknown; values?: Record<string, unknown> }): number {
  const fixtures = new Map(readFixtures().map(f => [f.id, f]));
  const name = cleanName(input.name);
  const pth = typeof input.path === "string" ? input.path.trim().slice(0, 60) : "";
  const lines: string[] = [];
  for (const [fid, arr] of Object.entries(input.values || {})) {
    const f = fixtures.get(Number(fid));
    if (!f) throw new Error(`Onbekende lamp ${fid}`);
    if (!Array.isArray(arr)) continue;
    const pairs: string[] = [];
    for (let k = 0; k < f.channels; k++) pairs.push(`${k},${int(arr[k], 0, 255, 0)}`);
    lines.push(`   <FixtureVal ID="${f.id}">${pairs.join(",")}</FixtureVal>`);
  }
  const block = `  <Function ID="${input.id ?? "__ID__"}" Type="Scene" Name="${escapeXml(name)}"${pth ? ` Path="${escapeXml(pth)}"` : ""}>\n   <Speed FadeIn="0" FadeOut="0" Duration="0" />\n${lines.join("\n")}\n  </Function>`;
  const xml = fs.readFileSync(WORKSPACE_FILE, "utf-8");
  const r = replaceOrAppend(xml, input.id, block);
  writeWorkspace(WORKSPACE_FILE, r.xml);
  return r.id;
}

export function saveChaser(input: { id?: number; name?: unknown; path?: unknown; direction?: unknown; runOrder?: unknown; steps?: unknown }): number {
  const name = cleanName(input.name);
  const pth = typeof input.path === "string" ? input.path.trim().slice(0, 60) : "";
  const known = new Set(readFunctions().map(f => f.id));
  const raw = Array.isArray(input.steps) ? input.steps : [];
  if (raw.length === 0) throw new Error("Een chase heeft minstens één stap nodig");
  if (raw.length > 200) throw new Error("Te veel stappen (maximaal 200)");
  const steps = raw.map((s: Record<string, unknown>, i: number) => {
    const scene = Number(s.scene);
    if (!known.has(scene) || scene === input.id) throw new Error(`Stap ${i + 1}: onbekende scène`);
    return { scene, fadeIn: int(s.fadeIn, 0, 600000, 0), hold: int(s.hold, 0, 3600000, 1000), fadeOut: int(s.fadeOut, 0, 600000, 0) };
  });
  const direction = input.direction === "Backward" ? "Backward" : "Forward";
  const runOrder = (["Loop", "SingleShot", "PingPong", "Random"] as const).find(r => r === input.runOrder) || "Loop";
  const first = steps[0];
  const stepXml = steps.map((s, i) => `   <Step Number="${i}" FadeIn="${s.fadeIn}" Hold="${s.hold}" FadeOut="${s.fadeOut}">${s.scene}</Step>`).join("\n");
  const block = `  <Function ID="${input.id ?? "__ID__"}" Type="Chaser" Name="${escapeXml(name)}"${pth ? ` Path="${escapeXml(pth)}"` : ""}>\n   <Speed FadeIn="${first.fadeIn}" FadeOut="${first.fadeOut}" Duration="${first.fadeIn + first.hold}" />\n   <Direction>${direction}</Direction>\n   <RunOrder>${runOrder}</RunOrder>\n   <SpeedModes FadeIn="Default" FadeOut="Default" Duration="Common" />\n${stepXml}\n  </Function>`;
  const xml = fs.readFileSync(WORKSPACE_FILE, "utf-8");
  const r = replaceOrAppend(xml, input.id, block);
  writeWorkspace(WORKSPACE_FILE, r.xml);
  return r.id;
}

/** Where a function is used (chaser steps, Virtual Console buttons and the like), so it is not deleted while something still needs it */
export function usesOf(id: number): string[] {
  const xml = fs.readFileSync(WORKSPACE_FILE, "utf-8");
  const used: string[] = [];
  for (const f of readFunctions()) {
    if (f.type === "Chaser" && (f as ChaserFn).steps.some(s => s.scene === id)) used.push(`chase "${f.name}"`);
  }
  const vc = xml.slice(xml.indexOf("<VirtualConsole>"));
  const buttons = [...vc.matchAll(/<Button Caption="([^"]*)" ID="\d+">[\s\S]*?<Function ID="(\d+)" \/>/g)].filter(m => Number(m[2]) === id);
  for (const b of buttons) used.push(`knop "${unescapeXml(b[1])}" in de Virtual Console`);
  return used;
}

export function deleteFunction(id: number) {
  const fn = readFunctions().find(f => f.id === id);
  if (!fn) throw new Error(`Functie ${id} bestaat niet`);
  const used = usesOf(id);
  if (used.length) throw new Error(`Kan niet verwijderen: wordt gebruikt door ${used.join(", ")}`);
  const xml = fs.readFileSync(WORKSPACE_FILE, "utf-8");
  const start = xml.indexOf("<Engine>"), end = xml.indexOf("</Engine>");
  const re = new RegExp(`[ \\t]*<Function ID="${id}" Type="\\w+"[^>]*>[\\s\\S]*?</Function>\\n?`);
  const eng = xml.slice(start, end).replace(re, "");
  writeWorkspace(WORKSPACE_FILE, xml.slice(0, start) + eng + xml.slice(end));
}

/** Ask the QLC+ container to load the workspace again (its start script watches this trigger file) and wait for the answer */
export async function reloadQlc(timeoutMs = 40000): Promise<{ ok: boolean; message: string }> {
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  const resultFile = path.join(RUNTIME_DIR, "reload.result");
  const started = Date.now();
  try { fs.unlinkSync(resultFile); } catch { /* none yet */ }
  fs.writeFileSync(path.join(RUNTIME_DIR, "reload"), String(started));
  while (Date.now() - started < timeoutMs) {
    await new Promise(r => setTimeout(r, 500));
    try {
      const res = fs.readFileSync(resultFile, "utf-8").trim();
      return res.startsWith("ok") ? { ok: true, message: "QLC+ heeft het werkbestand opnieuw geladen." } : { ok: false, message: `QLC+ kon het werkbestand niet laden: ${res}` };
    } catch { /* not there yet */ }
  }
  return { ok: false, message: "QLC+ reageerde niet op het opnieuw laden (de wijziging is wel opgeslagen)." };
}
