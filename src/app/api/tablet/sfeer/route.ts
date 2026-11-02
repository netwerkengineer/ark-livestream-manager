import { NextRequest, NextResponse } from "next/server";
import { getSettings } from "@/lib/settingsStore";
import { isAuthorized } from "@/lib/authHelper";
import { companion } from "@/lib/companionVars";
import { sendQlcOsc } from "@/lib/qlcControl";
export const dynamic = "force-dynamic";

// "Ark Sfeer": de standaardverlichting van de lichtinstallatie, dezelfde als die na het aanzetten van de stekker Geluid & Licht
// automatisch wordt gezet (lights_default.py): de Companion-knop van de standaard sfeer (bijv. Goud) en de Fresnel-sliders.
// Anders dan het opstartlicht wacht dit niet op de Iceray en slaat het niet over bij "automatisch licht uit": wie op de knop drukt, wil het.
export async function POST(req: NextRequest) {
  const session = await isAuthorized(req, undefined, "lights");
  if (!session) return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });

  const cfg = (getSettings().tuyaPlugs || []).find(p => p.lightsDefault)?.lightsDefault;
  if (!cfg) return NextResponse.json({ success: false, error: "Geen standaardverlichting ingesteld (lightsDefault bij de stekker Geluid & Licht)." }, { status: 404 });

  if (cfg.companionButton) {
    const done = await companion(`/api/location/${cfg.companionButton}/press`, "POST");
    if (done === null) return NextResponse.json({ success: false, error: "Companion niet bereikbaar" }, { status: 502 });
  }
  const fres = cfg.fresnels || {};
  for (const k of ["1", "2", "3", "4", "master"] as const) {
    const v = fres[k];
    if (typeof v === "number") sendQlcOsc(`/ark/light/fresnel/${k}`, Math.max(0, Math.min(255, Math.round(v))));
  }
  return NextResponse.json({ success: true, label: cfg.label || cfg.companionButton || "standaard" });
}
