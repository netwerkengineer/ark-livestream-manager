// Starting one of the own scenes or chases (the ones with a button in Lichtregie) from outside the web app: FreeShow calls
// /api/lights/trigger with a key, so no Companion button is needed for them.

import crypto from "crypto";
import WebSocket from "ws";
import { getSettings, saveSettings } from "./settingsStore";
import { readFunctions } from "./qlcFunctions";
import sferenData from "./sferen.json";

const COLOUR_GROUPS = [10, 30, 40, 50, 60, 100, 110, 120, 130];
const PALETTE_BASE_ID = 300;

/** The key for the FreeShow actions: made once and kept in the settings */
export function triggerToken(): string {
  const have = (getSettings() as any).lightsTriggerToken;
  if (typeof have === "string" && have.length >= 16) return have;
  const token = crypto.randomBytes(18).toString("hex");
  saveSettings({ lightsTriggerToken: token } as any);
  return token;
}

export function tokenMatches(given: string | null): boolean {
  if (!given) return false;
  const a = Buffer.from(given), b = Buffer.from(triggerToken());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** The address FreeShow uses to reach this app */
export function triggerUrl(id: number): string {
  const base = String((getSettings() as any).nextAuthUrl || "").replace(/\/+$/, "");
  return `${base}/api/lights/trigger?id=${id}&token=${triggerToken()}`;
}

/** The own scenes and chases that have a button in Lichtregie: the ones the setlist builder offers */
export const ownLights = () => readFunctions().filter(f => f.button);

/** Start one own scene or chase and stop what else is running from the colour groups, the palettes and the other own lights, so they do not mix */
export function startOwnLight(id: number): Promise<void> {
  const own = ownLights();
  if (!own.some(f => f.id === id)) return Promise.reject(new Error("Onbekende scène of chase"));
  const commands = [`QLC+API|setFunctionStatus|${id}|1`];
  for (const f of own) if (f.id !== id) commands.push(`QLC+API|setFunctionStatus|${f.id}|0`);
  for (const s of sferenData as { knop: number }[]) commands.push(`QLC+API|setFunctionStatus|${PALETTE_BASE_ID + s.knop}|0`);
  for (const g of COLOUR_GROUPS) for (let i = 0; i < 8; i++) commands.push(`QLC+API|setFunctionStatus|${g + i}|0`);

  const s = getSettings() as any;
  const host = !s.qlcHost || s.qlcHost === "localhost" ? "127.0.0.1" : s.qlcHost;
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${host}:9999/qlcplusWS`);
    const timer = setTimeout(() => { try { ws.close(); } catch { /* closed */ } reject(new Error("QLC+ reageert niet")); }, 5000);
    ws.on("error", () => { clearTimeout(timer); reject(new Error("Geen verbinding met QLC+")); });
    ws.on("open", () => {
      commands.forEach((c, i) => setTimeout(() => { if (ws.readyState === WebSocket.OPEN) ws.send(c); }, i * 4));
      setTimeout(() => { clearTimeout(timer); try { ws.close(); } catch { /* closed */ } resolve(); }, commands.length * 4 + 150);
    });
  });
}
