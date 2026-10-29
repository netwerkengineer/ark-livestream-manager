export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/authHelper";
import { channelTypes } from "@/lib/qlcFeed";

// GET -> what every DMX channel is (intensity with its colour, shutter ...), from QLC+ or from the last time we saw them
export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req, undefined, "lights"))) return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
  return NextResponse.json(await channelTypes());
}
