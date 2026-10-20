import { NextRequest, NextResponse } from "next/server";
import WebSocket from "ws";
import { getSettings } from "@/lib/settingsStore";
import { isAuthorized } from "@/lib/authHelper";
import { SFEREN, getSfeer } from "@/lib/sfeer";
export const dynamic = "force-dynamic";

// Start een sfeer (QLC+-scène "Ark: <naam>", functie-id 300 + volgnummer) met de hand, vanuit de lichtregie. Zelfde volgorde als de
// Companion-knoppen: eerst de nieuwe starten, daarna de andere sferen en de losse kleuren stoppen (zo vloeit het over).
const KLEUR_GROEPEN = [10, 30, 40, 50, 60, 100, 110, 120, 130];
const BASE_ID = 300;

export async function POST(req: NextRequest) {
  const session = await isAuthorized(req, undefined, "lights");
  if (!session) return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch { /* leeg */ }
  const uit = body.slug === "uit";
  const sfeer = getSfeer(body.slug);
  if (!uit && !sfeer) return NextResponse.json({ success: false, error: "Onbekende sfeer" }, { status: 400 });

  const s = getSettings() as any;
  const host = !s.qlcHost || s.qlcHost === "localhost" ? "127.0.0.1" : s.qlcHost;

  const commands: string[] = [];
  if (sfeer) commands.push(`QLC+API|setFunctionStatus|${BASE_ID + sfeer.knop}|1`);
  for (const other of SFEREN) if (!sfeer || other.slug !== sfeer.slug) commands.push(`QLC+API|setFunctionStatus|${BASE_ID + other.knop}|0`);
  for (const g of KLEUR_GROEPEN) for (let i = 0; i < 8; i++) commands.push(`QLC+API|setFunctionStatus|${g + i}|0`);

  return new Promise<Response>(resolve => {
    const ws = new WebSocket(`ws://${host}:9999/qlcplusWS`);
    const timer = setTimeout(() => { try { ws.close(); } catch { /* al dicht */ } resolve(NextResponse.json({ success: false, error: "QLC+ reageert niet" }, { status: 504 })); }, 4000);
    ws.on("error", () => { clearTimeout(timer); resolve(NextResponse.json({ success: false, error: "Geen verbinding met QLC+" }, { status: 502 })); });
    ws.on("open", () => {
      commands.forEach((c, i) => setTimeout(() => { if (ws.readyState === WebSocket.OPEN) ws.send(c); }, i * 4));
      setTimeout(() => { clearTimeout(timer); try { ws.close(); } catch { /* al dicht */ } resolve(NextResponse.json({ success: true, sfeer: sfeer?.slug || null })); }, commands.length * 4 + 150);
    });
  });
}
