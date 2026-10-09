export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { desktopGuard, desktopSongs } from "@/lib/trackDesktop";

// The songs of the library the desktop app can fetch to play on its own computer
export async function GET(req: NextRequest) {
  const guard = await desktopGuard(req);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });
  return NextResponse.json({ songs: desktopSongs() });
}
