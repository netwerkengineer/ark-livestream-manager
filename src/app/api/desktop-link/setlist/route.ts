export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { desktopGuard } from "@/lib/trackDesktop";
import { reportState } from "@/lib/desktopLink";

// The desktop app's setlist (now and then). A route of its own: the proxy in front of the server limits the
// requests per route (2 per second), and the state reports use up their route's share.
export async function POST(req: NextRequest) {
  const guard = await desktopGuard(req);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });
  try {
    const body = await req.json();
    if (!reportState(body?.player?.id, body?.player?.name, null, body?.setlist)) return NextResponse.json({ error: "Ongeldige speler" }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Ongeldig verzoek" }, { status: 400 });
  }
}
