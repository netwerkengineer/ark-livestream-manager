import { NextRequest, NextResponse } from "next/server";
import { getSettings } from "@/lib/settingsStore";
import { isAuthorized } from "@/lib/authHelper";
import WebSocket from "ws";
import { companion } from "@/lib/companionVars";
export const dynamic = "force-dynamic";

// Schakelaar "automatisch licht" en de laatste automatische wissel.
// Dit staat in Companion (aangepaste variabelen), omdat FreeShow de lichtkleuren via Companion-knoppen start:
// staat licht_auto op "uit", dan doen die knoppen niets en blijft de handbediening ongemoeid.

// Welk kleurenschema (QLC+-scène "Ark: <naam>", functie-id 300 en hoger) draait er nu? Die hebben geen knop in de
// Virtual Console, dus de lichtpagina kan ze niet uit de knopstanden afleiden.
function runningPalettes(): Promise<string[]> {
  const s = getSettings() as any;
  const host = !s.qlcHost || s.qlcHost === "localhost" ? "127.0.0.1" : s.qlcHost;
  return new Promise(resolve => {
    const found: string[] = [];
    let ws: WebSocket | null = null;
    const done = () => { try { ws?.close(); } catch { /* al dicht */ } resolve(found); };
    const timer = setTimeout(done, 3500);
    try {
      ws = new WebSocket(`ws://${host}:9999/qlcplusWS`);
    } catch { clearTimeout(timer); return resolve(found); }
    let queue: { id: string; name: string }[] = [];
    let current = -1;
    ws.on("error", () => { clearTimeout(timer); resolve(found); });
    ws.on("open", () => ws!.send("QLC+API|getFunctionsList"));
    ws.on("message", (raw: any) => {
      const msg = String(raw);
      if (msg.startsWith("QLC+API|getFunctionsList|")) {
        const p = msg.split("|").slice(2);
        for (let i = 0; i + 1 < p.length; i += 2) {
          if (/^Ark: /.test(p[i + 1]) && Number(p[i]) >= 300) queue.push({ id: p[i], name: p[i + 1].slice(5) });
        }
      } else if (msg.startsWith("QLC+API|getFunctionStatus|") && current >= 0) {
        if (msg.endsWith("Running")) found.push(queue[current].name);
      } else return;
      current++;
      if (current >= queue.length) { clearTimeout(timer); return done(); }
      ws!.send(`QLC+API|getFunctionStatus|${queue[current].id}`);
    });
  });
}

export async function GET(req: NextRequest) {
  const session = await isAuthorized(req, undefined, "lights");
  if (!session) return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });

  const [auto, kleur, tijd] = await Promise.all(
    ["licht_auto", "licht_kleur", "licht_tijd"].map(n => companion(`/api/custom-variable/${n}/value`, "GET"))
  );
  if (auto === null) return NextResponse.json({ available: false });
  const palet = await runningPalettes();
  return NextResponse.json({ available: true, auto: auto === "uit" ? "uit" : "aan", kleur: kleur || "", tijd: tijd || "", palet });
}

export async function POST(req: NextRequest) {
  const session = await isAuthorized(req, undefined, "lights");
  if (!session) return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch { /* leeg */ }
  if (body.auto !== "aan" && body.auto !== "uit") {
    return NextResponse.json({ error: "auto moet 'aan' of 'uit' zijn" }, { status: 400 });
  }
  const done = await companion(`/api/custom-variable/licht_auto/value?value=${body.auto}`, "POST");
  if (done === null) return NextResponse.json({ success: false, error: "Companion niet bereikbaar" }, { status: 502 });
  return NextResponse.json({ success: true, auto: body.auto });
}
