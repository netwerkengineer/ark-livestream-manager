export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/authHelper";
import { getX32Routing, setX32Routing } from "@/lib/x32Control";
import { getOBSState } from "@/lib/obsManager";
import { getBridgeState } from "@/lib/reaperControl";

const msg = (err: unknown) => (err instanceof Error ? err.message : String(err));

// REC/PLAY van de X32 lezen (virtuele soundcheck). Alleen voor wie de Tracks-tab mag gebruiken.
export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req, undefined, "tracks"))) return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
  try {
    return NextResponse.json({ mode: await getX32Routing() });
  } catch (err) {
    return NextResponse.json({ error: msg(err) }, { status: 502 });
  }
}

// body: { mode: "REC" | "PLAY" }. Terug naar REC mag altijd; PLAY alleen als er een opname klaarstaat, er niet
// opgenomen wordt, niets live gaat en er geen nummer afspeelt (PLAY schakelt alle microfoons van de zaal uit).
export async function POST(req: NextRequest) {
  const session = await isAuthorized(req, undefined, "tracks");
  if (!session) return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
  try {
    const { mode } = await req.json();
    if (mode !== "REC" && mode !== "PLAY") return NextResponse.json({ error: "Ongeldige stand" }, { status: 400 });
    if (mode === "PLAY") {
      if (getOBSState().obsStats?.outputActive === true) {
        return NextResponse.json({ error: "De livestream staat aan: de X32 gaat niet op PLAY (de microfoons zouden uitvallen)." }, { status: 409 });
      }
      const bridge = await getBridgeState();
      if (!bridge?.opnameAfspelen) return NextResponse.json({ error: "Zet eerst een opname klaar om af te spelen." }, { status: 409 });
      if (bridge.opname) return NextResponse.json({ error: "Er loopt een opname." }, { status: 409 });
    }
    const now = await setX32Routing(mode);
    console.log(`[X32] Routing -> ${now} (${session.username})`);
    return NextResponse.json({ mode: now });
  } catch (err) {
    return NextResponse.json({ error: msg(err) }, { status: 502 });
  }
}
