export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { desktopGuard, cuesFor } from "@/lib/trackDesktop";

// The cue table of a song (empty when no text is linked yet)
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await desktopGuard(req);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });
  const { id } = await params;
  return NextResponse.json({ cues: await cuesFor(id) });
}
