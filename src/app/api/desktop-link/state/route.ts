export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { desktopGuard } from "@/lib/trackDesktop";
import { reportState } from "@/lib/desktopLink";
import { toReaperState } from "@/lib/desktopEngine";

// The desktop app reports its state (and its setlist, now and then); the stage view reads it from here
export async function POST(req: NextRequest) {
  const guard = await desktopGuard(req);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });
  try {
    const body = await req.json();
    // the app (the program itself) sends the raw state of its player and its song list; the page sends the setlist now and then
    let state = body?.state;
    if (body?.engine && typeof body.engine === "object") {
      const songs = Array.isArray(body.library?.songs) ? body.library.songs : [];
      state = toReaperState(body.engine, songs);
    }
    if (!reportState(body?.player?.id, body?.player?.name, state, body?.setlist)) {
      return NextResponse.json({ error: "Ongeldige speler" }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Ongeldig verzoek" }, { status: 400 });
  }
}
