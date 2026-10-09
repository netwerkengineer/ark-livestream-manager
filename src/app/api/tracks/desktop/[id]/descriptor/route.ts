export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { desktopGuard, describeTrack } from "@/lib/trackDesktop";

// Description of one song (stems, sections, tempo) for ark-player, read from the zip
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await desktopGuard(req);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });
  const { id } = await params;
  try {
    return NextResponse.json(await describeTrack(id));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 404 });
  }
}
