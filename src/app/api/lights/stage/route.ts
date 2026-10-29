export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/authHelper";
import { readStage, saveStage } from "@/lib/lightsStage";

// GET -> the fixtures of the QLC+ workspace and where they hang on the stage; PUT {width, depth, height, fixtures} -> save the layout
export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req, undefined, "lights"))) return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
  try {
    return NextResponse.json(readStage());
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  if (!(await isAuthorized(req, undefined, "lights"))) return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
  try {
    const body = await req.json();
    return NextResponse.json({ stage: saveStage(body) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
