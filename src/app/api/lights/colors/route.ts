export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/authHelper";
import { readColors, saveColors } from "@/lib/lightsColors";

// GET -> the colour library; PUT {colors: [{id, name, hex}]} -> save it
export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req, undefined, "lights"))) return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
  return NextResponse.json({ colors: readColors() });
}

export async function PUT(req: NextRequest) {
  if (!(await isAuthorized(req, undefined, "lights"))) return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
  try {
    const body = await req.json();
    return NextResponse.json({ colors: saveColors(body.colors) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
