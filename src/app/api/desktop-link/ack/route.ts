export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { desktopGuard } from "@/lib/trackDesktop";
import { ack } from "@/lib/desktopLink";

// The desktop app says whether it carried out a command
export async function POST(req: NextRequest) {
  const guard = await desktopGuard(req);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });
  try {
    const b = await req.json();
    if (typeof b.player === "string" && typeof b.id === "string") ack(b.player, b.id, !!b.ok, typeof b.error === "string" ? b.error.slice(0, 200) : undefined);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Ongeldig verzoek" }, { status: 400 });
  }
}
