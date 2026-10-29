// Scenes and chasers of the QLC+ workspace: read them, change them and put them back. The workspace file is edited as text (only the
// <Function> blocks that change), so everything else in it - fixtures, universes, the Virtual Console - stays exactly as QLC+ wrote it.
// After a change QLC+ has to load the file again (reloadQlc); a copy of the previous file is kept in config/backups.

import fs from "fs";
import path from "path";
import { WORKSPACE_FILE, readFixtures } from "./qlcWorkspace";
import { TEMPO_PATH, TEMPO_MAX_MS, oscChannel } from "./lightsTempo";

export interface SceneFn { id: number; type: "Scene"; name: string; path: string; values: Record<number, number[]>; button?: boolean }
export interface ChaserStep { scene: number; fadeIn: number; hold: number; fadeOut: number }
export interface ChaserFn {
  id: number; type: "Chaser"; name: string; path: string;
  direction: "Forward" | "Backward"; runOrder: "Loop" | "SingleShot" | "PingPong" | "Random";
  steps: ChaserStep[];
  button?: boolean;
  /** follows the tap tempo: a step lasts one beat */
  tempo?: boolean;
}
export interface OtherFn { id: number; type: string; name: string; path: string; button?: boolean }
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
  const buttons = new Set(customButtons(xml).map(b => b.id));
  const tempo = new Set(customTempo(xml));
  for (const f of out) { f.button = buttons.has(f.id); if (f.type === "Chaser") (f as ChaserFn).tempo = tempo.has(f.id); }
  return out;
}

// ---- the Virtual Console frame with the buttons of the scenes and chases made in the web app. The buttons that were already there stay as they are.
// A button has the function's number as its own number (that is how the other buttons of this workspace are numbered too).
export const CUSTOM_CAPTION = "Eigen scènes en chases";
const CUSTOM_FRAME_ID = 400;
const frameOpen = () => `<Frame Caption="${escapeXml(CUSTOM_CAPTION)}" ID="${CUSTOM_FRAME_ID}">`;

function customRange(xml: string): { start: number; end: number } | null {
  const start = xml.indexOf(frameOpen());
  if (start < 0) return null;
  const close = xml.indexOf("</Frame>", start);
  return close < 0 ? null : { start, end: close + "</Frame>".length };
}

export function customButtons(xml: string): { id: number; caption: string }[] {
  const r = customRange(xml);
  if (!r) return [];
  return [...xml.slice(r.start, r.end).matchAll(/<Button Caption="([^"]*)" ID="(\d+)">/g)].map(m => ({ id: Number(m[2]), caption: unescapeXml(m[1]) }));
}

const TEMPO_DIAL_ID = 410;
// The speed dial multiplier of a function that follows the dial one to one (the same value the Strobe Speed dial of this workspace uses)
const ONE_TO_ONE = 6;

/** The chases that follow the tap tempo: the functions of the "Tempo" speed dial in the frame */
export function customTempo(xml: string): number[] {
  const r = customRange(xml);
  if (!r) return [];
  const frame = xml.slice(r.start, r.end);
  const dial = /<SpeedDial Caption="Tempo" ID="\d+">[\s\S]*?<\/SpeedDial>/.exec(frame);
  return dial ? [...dial[0].matchAll(/<Function FadeIn="\d+" FadeOut="\d+" Duration="\d+">(\d+)<\/Function>/g)].map(m => Number(m[1])) : [];
}

function tempoDialXml(ids: number[], y: number): string {
  return `    <SpeedDial Caption="Tempo" ID="${TEMPO_DIAL_ID}">
     <Appearance>
      <FrameStyle>Sunken</FrameStyle>
      <Font>Arial,10,-1,5,400,0,0,0,0,0,0,0,0,0,0,1,Regular</Font>
     </Appearance>
     <WindowState Visible="True" X="10" Y="${y}" Width="170" Height="170" />
     <Visibility>43</Visibility>
${ids.map(id => `     <Function FadeIn="0" FadeOut="0" Duration="${ONE_TO_ONE}">${id}</Function>`).join("\n")}
     <AbsoluteValue Minimum="0" Maximum="${TEMPO_MAX_MS}"><Input Universe="1" Channel="${oscChannel(TEMPO_PATH)}" /></AbsoluteValue>
     <Time>0</Time>
    </SpeedDial>`;
}

function customFrameXml(buttons: { id: number; caption: string }[], tempo: number[]): string {
  const rows = Math.max(1, Math.ceil(buttons.length / 2));
  const dialY = 40 + rows * 70;
  const btn = buttons.map((b, i) => `    <Button Caption="${escapeXml(b.caption)}" ID="${b.id}">
     <WindowState Visible="True" X="${10 + (i % 2) * 190}" Y="${40 + Math.floor(i / 2) * 70}" Width="180" Height="60" />
     <Function ID="${b.id}" />
     <Action>Toggle</Action>
    </Button>`).join("\n");
  return `   ${frameOpen()}
    <Appearance>
     <FrameStyle>Sunken</FrameStyle>
     <Font>Arial,12,-1,5,400,0,0,0,0,0,0,0,0,0,0,1,Regular</Font>
    </Appearance>
    <WindowState Visible="True" X="760" Y="40" Width="390" Height="${60 + rows * 70 + (tempo.length ? 180 : 0)}" />
    <AllowChildren>True</AllowChildren>
    <AllowResize>True</AllowResize>
    <ShowHeader>True</ShowHeader>
    <ShowEnableButton>True</ShowEnableButton>
    <Collapsed>False</Collapsed>
    <Disabled>False</Disabled>
${btn}${tempo.length ? "\n" + tempoDialXml(tempo, dialY) : ""}
   </Frame>`;
}

/** Make sure the frame has exactly these buttons (an empty list removes the frame) */
function setCustomButtons(xml: string, buttons: { id: number; caption: string }[], tempo: number[] = customTempo(xml)): string {
  const r = customRange(xml);
  if (buttons.length === 0 && tempo.length === 0) {
    if (!r) return xml;
    const from = xml.lastIndexOf("\n", r.start);
    return xml.slice(0, from < 0 ? r.start : from) + xml.slice(r.end);
  }
  const frame = customFrameXml(buttons, tempo);
  if (r) {
    const from = xml.lastIndexOf("\n", r.start);
    return xml.slice(0, from < 0 ? r.start : from + 1) + frame + xml.slice(r.end);
  }
  const vcEnd = xml.indexOf("</VirtualConsole>");
  const top = xml.lastIndexOf("</Frame>", vcEnd);   // the closing tag of the main frame
  if (vcEnd < 0 || top < 0) throw new Error("Geen Virtual Console in het werkbestand");
  const lineStart = xml.lastIndexOf("\n", top) + 1;
  return xml.slice(0, lineStart) + frame + "\n" + xml.slice(lineStart);
}

function applyButton(xml: string, id: number, caption: string, want: boolean | undefined): string {
  if (want === undefined) {
    // a renamed function keeps its button but gets the new caption
    const cur = customButtons(xml).find(b => b.id === id);
    if (!cur || !caption || cur.caption === caption) return xml;
    return setCustomButtons(xml, customButtons(xml).map(b => (b.id === id ? { id, caption } : b)));
  }
  const list = customButtons(xml).filter(b => b.id !== id);
  const had = customButtons(xml).some(b => b.id === id);
  if (want) list.push({ id, caption });
  else if (!had) return xml;
  return setCustomButtons(xml, list.sort((a, b) => a.id - b.id));
}

/** Put a chase on the tap tempo dial, or take it off */
function applyTempo(xml: string, id: number, want: boolean | undefined): string {
  if (want === undefined) return xml;
  const cur = customTempo(xml);
  if (want === cur.includes(id)) return xml;
  const next = want ? [...cur, id].sort((a, b) => a - b) : cur.filter(x => x !== id);
  return setCustomButtons(xml, customButtons(xml), next);
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

export function saveScene(input: { id?: number; name?: unknown; path?: unknown; values?: Record<string, unknown>; button?: boolean }): number {
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
  writeWorkspace(WORKSPACE_FILE, applyButton(r.xml, r.id, name, input.button));
  return r.id;
}

export function saveChaser(input: { id?: number; name?: unknown; path?: unknown; direction?: unknown; runOrder?: unknown; steps?: unknown; button?: boolean; tempo?: boolean }): number {
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
  writeWorkspace(WORKSPACE_FILE, applyTempo(applyButton(r.xml, r.id, name, input.button), r.id, input.tempo));
  return r.id;
}

/** Where a function is used (chaser steps, Virtual Console buttons and the like), so it is not deleted while something still needs it */
export function usesOf(id: number): string[] {
  const xml = fs.readFileSync(WORKSPACE_FILE, "utf-8");
  const used: string[] = [];
  for (const f of readFunctions()) {
    if (f.type === "Chaser" && (f as ChaserFn).steps.some(s => s.scene === id)) used.push(`chase "${f.name}"`);
  }
  const r = customRange(xml);
  const vc = (r ? xml.slice(0, r.start) + xml.slice(r.end) : xml).slice(xml.indexOf("<VirtualConsole>"));   // the web app's own buttons do not count
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
  writeWorkspace(WORKSPACE_FILE, applyTempo(applyButton(xml.slice(0, start) + eng + xml.slice(end), id, "", false), id, false));
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
