export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/authHelper";
import { logActivity } from "@/lib/activityLog";
import { getConfig, setConfig, status } from "@/lib/desktopLink";

// GET: which player the web app controls now (REAPER or a desktop app), who is connected
// POST { backend: "reaper" | "desktop", player?: id }: switch (a deliberate choice: there is no automatic fall-back to REAPER,
// because a second source could start playing while the app is still going)
export async function GET(req: NextRequest) {
  const session = await isAuthorized(req, undefined, "tracks");
  if (!session) return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
  return NextResponse.json(status());
}

export async function POST(req: NextRequest) {
  const session = await isAuthorized(req, undefined, "tracks");
  if (!session) return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
  try {
    const b = await req.json();
    if (b.backend !== "reaper" && b.backend !== "desktop") return NextResponse.json({ error: "Onbekende keuze" }, { status: 400 });
    const before = getConfig();
    const player = b.backend === "desktop" && typeof b.player === "string" && /^[\w-]{8,64}$/.test(b.player) ? b.player : null;
    setConfig({ backend: b.backend, player });
    if (before.backend !== b.backend || before.player !== player) {
      logActivity("system", `Bediening van Tracks gezet op ${b.backend === "desktop" ? "de desktop-app" : "REAPER"} door ${session.username}.`);
    }
    return NextResponse.json(status());
  } catch {
    return NextResponse.json({ error: "Ongeldig verzoek" }, { status: 400 });
  }
}
