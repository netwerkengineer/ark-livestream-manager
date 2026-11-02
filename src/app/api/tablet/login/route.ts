import { NextRequest, NextResponse } from "next/server";
import { isInternalRequest } from "@/lib/lanOnly";
import {
  TABLET_COOKIE, TABLET_COOKIE_MAX_AGE, tabletPin, tabletToken, pinMatches,
  loginLocked, registerLoginFailure, clearLoginFailures,
} from "@/lib/tabletAuth";
export const dynamic = "force-dynamic";

// Pincode van het tablet controleren en het tablet "onthouden" met een cookie. Alleen vanaf het interne netwerk.
export async function POST(req: NextRequest) {
  if (!isInternalRequest(name => req.headers.get(name))) {
    return NextResponse.json({ error: "Niet gevonden" }, { status: 404 });
  }
  if (!tabletPin()) {
    return NextResponse.json({ error: "Er is nog geen tablet-pincode ingesteld (Instellingen → Verbindingen)." }, { status: 403 });
  }
  if (loginLocked()) {
    return NextResponse.json({ error: "Te veel pogingen. Probeer het over 5 minuten opnieuw." }, { status: 429 });
  }
  let body: any = {};
  try { body = await req.json(); } catch { /* leeg */ }
  if (!pinMatches(String(body.pin || ""))) {
    registerLoginFailure();
    return NextResponse.json({ error: "Onjuiste pincode" }, { status: 401 });
  }
  clearLoginFailures();
  const res = NextResponse.json({ success: true });
  res.cookies.set(TABLET_COOKIE, tabletToken() as string, {
    httpOnly: true, sameSite: "lax", secure: false, path: "/", maxAge: TABLET_COOKIE_MAX_AGE,
  });
  return res;
}
