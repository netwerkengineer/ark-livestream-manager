export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/authHelper";
import { readTempo, setTempo } from "@/lib/lightsTempo";

// GET -> the tempo that was set last; POST {bpm, mult} -> turn the Tempo dial of the chases that follow the beat
export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req, undefined, "lights"))) return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
  return NextResponse.json({ tempo: readTempo() });
}

export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req, undefined, "lights"))) return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
  try {
    return NextResponse.json({ tempo: setTempo(await req.json()) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
