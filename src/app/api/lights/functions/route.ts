export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/authHelper";
import { readFixtures } from "@/lib/qlcWorkspace";
import { readFunctions, saveScene, saveChaser, deleteFunction, reloadQlc } from "@/lib/qlcFunctions";
import { getSettings } from "@/lib/settingsStore";
import { readTempo, sendTempo } from "@/lib/lightsTempo";
import WebSocket from "ws";

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

// GET -> the fixtures and the scenes and chasers of the QLC+ workspace
export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req, undefined, "lights"))) return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
  try {
    return NextResponse.json({ fixtures: readFixtures(), functions: readFunctions() });
  } catch (err) {
    return NextResponse.json({ error: message(err) }, { status: 500 });
  }
}

// POST {action: "save-scene" | "save-chaser" | "delete", ...} -> change the workspace and have QLC+ load it again
export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req, undefined, "lights"))) return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
  try {
    const body = await req.json();
    if (body.action === "start" || body.action === "stop") {
      await setFunctionStatus(Number(body.id), body.action === "start");
      return NextResponse.json({ ok: true });
    }
    let id: number | undefined;
    if (body.action === "save-scene") id = saveScene(body);
    else if (body.action === "save-chaser") id = saveChaser(body);
    else if (body.action === "delete") { id = Number(body.id); deleteFunction(id); }
    else return NextResponse.json({ error: "Onbekende actie" }, { status: 400 });
    const reload = body.reload === false ? { ok: true, message: "" } : await reloadQlc();
    // QLC+ starts from the saved speeds again after loading: give the chases that follow the beat the tempo that was set
    const tempo = readTempo();
    if (reload.ok && tempo) setTimeout(() => sendTempo(tempo), 1500);
    return NextResponse.json({ id, reload, ...(await getLists()) });
  } catch (err) {
    return NextResponse.json({ error: message(err) }, { status: 400 });
  }
}

async function getLists() {
  return { fixtures: readFixtures(), functions: readFunctions() };
}

/** Start or stop one function in QLC+ (to try a scene or chase on the real lights) */
function setFunctionStatus(id: number, on: boolean): Promise<void> {
  const host = getSettings().qlcHost || "127.0.0.1";
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${host}:9999/qlcplusWS`);
    const timer = setTimeout(() => { try { ws.close(); } catch { /* closed */ } reject(new Error("Geen verbinding met QLC+")); }, 5000);
    ws.on("open", () => { ws.send(`QLC+API|setFunctionStatus|${id}|${on ? 1 : 0}`); setTimeout(() => { clearTimeout(timer); ws.close(); resolve(); }, 150); });
    ws.on("error", () => { clearTimeout(timer); reject(new Error("Geen verbinding met QLC+")); });
  });
}
