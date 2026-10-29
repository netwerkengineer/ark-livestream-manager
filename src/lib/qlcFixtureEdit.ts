// Add, move and remove lamps in the QLC+ workspace. Like the scenes, the file is edited as text: only the <Fixture> blocks and what refers
// to a removed lamp change.

import fs from "fs";
import path from "path";
import { WORKSPACE_FILE, readFixtures } from "./qlcWorkspace";
import { findFixture } from "./qlcFixtureLib";

const escapeXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function writeWorkspace(xml: string) {
  const dir = path.join(path.dirname(WORKSPACE_FILE), "backups");
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(WORKSPACE_FILE, path.join(dir, `ark_church_lighting.${new Date().toISOString().replace(/[:.]/g, "-")}.qxw`));
  const old = fs.readdirSync(dir).filter(f => f.endsWith(".qxw")).sort();
  for (const f of old.slice(0, Math.max(0, old.length - 30))) fs.unlinkSync(path.join(dir, f));
  fs.writeFileSync(WORKSPACE_FILE, xml);   // in place: the QLC+ container has this single file mounted
}

const cleanName = (v: unknown) => {
  const s = typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "";
  if (!s || s.length > 60) throw new Error("De naam moet tussen 1 en 60 tekens zijn");
  return s;
};
const intIn = (v: unknown, lo: number, hi: number, what: string) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < lo || n > hi) throw new Error(`${what} moet een heel getal van ${lo} tot ${hi} zijn`);
  return n;
};

/** Which lamp already uses (part of) these channels? */
export function overlap(universe: number, address: number, channels: number, ignoreId?: number): string | null {
  for (const f of readFixtures()) {
    if (f.id === ignoreId || f.universe !== universe) continue;
    if (address < f.address + f.channels && f.address < address + channels) return `${f.name} (kanaal ${f.address + 1}–${f.address + f.channels})`;
  }
  return null;
}

/** The first free run of `channels` channels after the last lamp (or the first gap that is big enough) */
export function freeAddress(universe: number, channels: number): number {
  const used = readFixtures().filter(f => f.universe === universe).sort((a, b) => a.address - b.address);
  let at = 0;
  for (const f of used) {
    if (f.address - at >= channels) return at;
    at = Math.max(at, f.address + f.channels);
  }
  return at;
}

export function addFixtures(input: { manufacturer?: unknown; model?: unknown; mode?: unknown; name?: unknown; universe?: unknown; address?: unknown; count?: unknown; force?: unknown }): number[] {
  const lib = findFixture(String(input.manufacturer), String(input.model));
  if (!lib) throw new Error("Deze lamp staat niet in de QLC+-bibliotheek");
  const mode = lib.modes.find(m => m.n === input.mode);
  if (!mode) throw new Error("Onbekende modus voor deze lamp");
  const channels = mode.c.length;
  const name = cleanName(input.name);
  const universe = intIn(input.universe ?? 0, 0, 3, "Het universum");
  const count = intIn(input.count ?? 1, 1, 40, "Het aantal");
  const address = intIn(input.address, 0, 511, "Het adres");
  if (address + channels * count > 512) throw new Error(`Past niet: ${count} × ${channels} kanalen vanaf kanaal ${address + 1} gaat voorbij kanaal 512`);
  for (let i = 0; i < count; i++) {
    const clash = overlap(universe, address + i * channels, channels);
    if (clash && !input.force) throw new Error(`Kanaal ${address + i * channels + 1} overlapt met ${clash}`);
  }
  let xml = fs.readFileSync(WORKSPACE_FILE, "utf-8");
  const ids = [...xml.slice(0, xml.indexOf("</Engine>")).matchAll(/<Fixture>[\s\S]*?<ID>(\d+)<\/ID>/g)].map(m => Number(m[1]));
  let next = (ids.length ? Math.max(...ids) : -1) + 1;
  const made: number[] = [], blocks: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = next++;
    made.push(id);
    blocks.push(`  <Fixture>
   <Manufacturer>${escapeXml(lib.m)}</Manufacturer>
   <Model>${escapeXml(lib.d)}</Model>
   <Mode>${escapeXml(mode.n)}</Mode>
   <ID>${id}</ID>
   <Name>${escapeXml(count > 1 ? `${name} ${i + 1}` : name)}</Name>
   <Universe>${universe}</Universe>
   <Address>${address + i * channels}</Address>
   <Channels>${channels}</Channels>
  </Fixture>`);
  }
  const last = xml.lastIndexOf("</Fixture>", xml.indexOf("</Engine>"));
  if (last < 0) throw new Error("Geen lampen in het werkbestand om achter te plaatsen");
  const at = last + "</Fixture>".length;
  xml = xml.slice(0, at) + "\n" + blocks.join("\n") + xml.slice(at);
  writeWorkspace(xml);
  return made;
}

export function updateFixture(input: { id?: unknown; name?: unknown; universe?: unknown; address?: unknown; force?: unknown }): void {
  const id = intIn(input.id, 0, 100000, "Het nummer");
  const cur = readFixtures().find(f => f.id === id);
  if (!cur) throw new Error(`Lamp ${id} bestaat niet`);
  const name = cleanName(input.name ?? cur.name);
  const universe = intIn(input.universe ?? cur.universe, 0, 3, "Het universum");
  const address = intIn(input.address ?? cur.address, 0, 511, "Het adres");
  if (address + cur.channels > 512) throw new Error("Past niet: gaat voorbij kanaal 512");
  const clash = overlap(universe, address, cur.channels, id);
  if (clash && !input.force) throw new Error(`Overlapt met ${clash}`);
  const xml = fs.readFileSync(WORKSPACE_FILE, "utf-8");
  const re = new RegExp(`(<Fixture>\\s*<Manufacturer>[^<]*</Manufacturer>\\s*<Model>[^<]*</Model>\\s*<Mode>[^<]*</Mode>\\s*<ID>${id}</ID>\\s*<Name>)[^<]*(</Name>\\s*<Universe>)\\d+(</Universe>\\s*<Address>)\\d+(</Address>)`);
  if (!re.test(xml)) throw new Error("Kon de lamp niet in het werkbestand vinden");
  writeWorkspace(xml.replace(re, (_m, a, b, c, d) => `${a}${escapeXml(name)}${b}${universe}${c}${address}${d}`));
}

/** What would be affected by removing this lamp: scenes that set its channels, and Virtual Console sliders that control it */
export function usageOfFixture(id: number): { scenes: string[]; sliders: string[] } {
  const xml = fs.readFileSync(WORKSPACE_FILE, "utf-8");
  const eng = xml.slice(xml.indexOf("<Engine>"), xml.indexOf("</Engine>"));
  const scenes = [...eng.matchAll(/<Function ID="\d+" Type="Scene" Name="([^"]*)"[^>]*>[\s\S]*?<\/Function>/g)]
    .filter(m => new RegExp(`<FixtureVal ID="${id}">`).test(m[0])).map(m => m[1]);
  const vc = xml.slice(xml.indexOf("<VirtualConsole>"));
  const sliders = [...vc.matchAll(/<Slider Caption="([^"]*)"[\s\S]*?<\/Slider>/g)].filter(m => new RegExp(`<Channel Fixture="${id}">`).test(m[0])).map(m => m[1]);
  return { scenes, sliders };
}

export function deleteFixture(id: number): { scenesChanged: number } {
  if (!readFixtures().some(f => f.id === id)) throw new Error(`Lamp ${id} bestaat niet`);
  const { sliders } = usageOfFixture(id);
  if (sliders.length) throw new Error(`Kan niet verwijderen: de lamp wordt bestuurd door de schuif${sliders.length > 1 ? "ven" : ""} ${sliders.map(s => `"${s}"`).join(", ")} in de Virtual Console`);
  let xml = fs.readFileSync(WORKSPACE_FILE, "utf-8");
  const before = xml;
  const eng0 = xml.indexOf("<Engine>"), eng1 = xml.indexOf("</Engine>");
  let eng = xml.slice(eng0, eng1);
  eng = eng.replace(new RegExp(`[ \\t]*<Fixture>\\s*<Manufacturer>[^<]*</Manufacturer>\\s*<Model>[^<]*</Model>\\s*<Mode>[^<]*</Mode>\\s*<ID>${id}</ID>[\\s\\S]*?</Fixture>\\n?`), "");
  let scenesChanged = 0;
  eng = eng.replace(new RegExp(`[ \\t]*<FixtureVal ID="${id}">[^<]*</FixtureVal>\\n?`, "g"), () => { scenesChanged++; return ""; });
  xml = xml.slice(0, eng0) + eng + xml.slice(eng1);
  xml = xml.replace(new RegExp(`[ \\t]*<FxItem ID="${id}"[^>]*/>\\n?`, "g"), "");
  if (xml === before) throw new Error("Er is niets veranderd");
  writeWorkspace(xml);
  return { scenesChanged };
}
