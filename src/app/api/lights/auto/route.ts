import { NextRequest, NextResponse } from "next/server";
import { getSettings } from "@/lib/settingsStore";
import { isAuthorized } from "@/lib/authHelper";
export const dynamic = "force-dynamic";

// Schakelaar "automatisch licht" en de laatste automatische wissel.
// Dit staat in Companion (aangepaste variabelen), omdat FreeShow de lichtkleuren via Companion-knoppen start:
// staat licht_auto op "uit", dan doen die knoppen niets en blijft de handbediening ongemoeid.

function companionBases(): string[] {
  const s = getSettings() as any;
  const port = s.companionPort || 8000;
  const hosts = [s.companionHost, "127.0.0.1", "172.17.0.1", "companion"].filter(Boolean);
  return Array.from(new Set(hosts)).map(h => `http://${h}:${port}`);
}

async function companion(pathAndQuery: string, method: "GET" | "POST"): Promise<string | null> {
  for (const base of companionBases()) {
    try {
      const res = await fetch(`${base}${pathAndQuery}`, { method, cache: "no-store", signal: AbortSignal.timeout(2500) });
      if (res.ok) return (await res.text()).trim();
    } catch {
      // volgende host proberen
    }
  }
  return null;
}

export async function GET(req: NextRequest) {
  const session = await isAuthorized(req, undefined, "lights");
  if (!session) return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });

  const [auto, kleur, tijd] = await Promise.all(
    ["licht_auto", "licht_kleur", "licht_tijd"].map(n => companion(`/api/custom-variable/${n}/value`, "GET"))
  );
  if (auto === null) return NextResponse.json({ available: false });
  return NextResponse.json({ available: true, auto: auto === "uit" ? "uit" : "aan", kleur: kleur || "", tijd: tijd || "" });
}

export async function POST(req: NextRequest) {
  const session = await isAuthorized(req, undefined, "lights");
  if (!session) return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch { /* leeg */ }
  if (body.auto !== "aan" && body.auto !== "uit") {
    return NextResponse.json({ error: "auto moet 'aan' of 'uit' zijn" }, { status: 400 });
  }
  const done = await companion(`/api/custom-variable/licht_auto/value?value=${body.auto}`, "POST");
  if (done === null) return NextResponse.json({ success: false, error: "Companion niet bereikbaar" }, { status: 502 });
  return NextResponse.json({ success: true, auto: body.auto });
}
