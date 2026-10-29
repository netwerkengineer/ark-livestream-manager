import { NextRequest, NextResponse } from "next/server";
import { tokenMatches, startOwnLight } from "@/lib/lightsTrigger";
import { companion } from "@/lib/companionVars";
export const dynamic = "force-dynamic";

// Called by the FreeShow action "Licht: <naam>" of a song that has one of the own scenes or chases as its light.
// FreeShow has no login, so the call carries a key (settings.lightsTriggerToken) and can only start the own lights of Lichtregie.
// Like the Companion buttons it does nothing while "automatisch licht" is off.
async function handle(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  if (!tokenMatches(q.get("token"))) return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
  const id = Number(q.get("id"));
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Geen geldige id" }, { status: 400 });
  if ((await companion("/api/custom-variable/licht_auto/value", "GET")) === "uit") return NextResponse.json({ success: true, skipped: "automatisch licht staat uit" });
  try {
    await startOwnLight(id);
    return NextResponse.json({ success: true, id });
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}

export const POST = handle;
export const GET = handle;
