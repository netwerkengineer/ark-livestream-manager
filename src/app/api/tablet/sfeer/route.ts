import { NextRequest, NextResponse } from "next/server";
import { getSettings } from "@/lib/settingsStore";
import { isAuthorized } from "@/lib/authHelper";
import { companion } from "@/lib/companionVars";
import { sendQlcOsc } from "@/lib/qlcControl";
export const dynamic = "force-dynamic";

// "Ark Sfeer": de standaardverlichting van de lichtinstallatie (eigen instelling arkSfeer, anders de lightsDefault van de stekker Geluid & Licht,
// dezelfde als die bij het opstarten automatisch wordt gezet, lights_default.py): de Companion-knop van de standaard sfeer (bijv. Goud) en de Fresnel-sliders.
// Anders dan het opstartlicht wacht dit niet op de Iceray en slaat het niet over bij "automatisch licht uit": wie op de knop drukt, wil het.
export async function POST(req: NextRequest) {
  const session = await isAuthorized(req, undefined, "lights");
  if (!session) return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });

  const settings = getSettings();
  const eigen = settings.arkSfeer;
  const stekker = (settings.tuyaPlugs || []).find(p => p.lightsDefault)?.lightsDefault;
  // Eigen instelling "Ark Sfeer" (Instellingen → Verbindingen → Tablet regiekamer); anders de standaardverlichting van de stekker
  const cfg = eigen?.companionButton
    ? { companionButton: eigen.companionButton, label: eigen.label, fresnels: typeof eigen.fresnel === "number" ? { "1": eigen.fresnel, "2": eigen.fresnel, "3": eigen.fresnel, "4": eigen.fresnel, master: 255 } : {} }
    : stekker;
  if (!cfg) return NextResponse.json({ success: false, error: "Ark Sfeer is nog niet ingesteld (Instellingen → Verbindingen → Tablet regiekamer)." }, { status: 404 });

  if (cfg.companionButton) {
    const done = await companion(`/api/location/${cfg.companionButton}/press`, "POST");
    if (done === null) return NextResponse.json({ success: false, error: "Companion niet bereikbaar" }, { status: 502 });
  }
  const fres: { [k: string]: number | undefined } = cfg.fresnels || {};
  for (const k of ["1", "2", "3", "4", "master"]) {
    const v = fres[k];
    if (typeof v === "number") sendQlcOsc(`/ark/light/fresnel/${k}`, Math.max(0, Math.min(255, Math.round(v))));
  }
  return NextResponse.json({ success: true, label: cfg.label || cfg.companionButton || "standaard" });
}
