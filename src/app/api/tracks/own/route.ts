export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/authHelper";
import { createOwn } from "@/lib/trackOwn";
import { CHUNK_SIZE } from "@/lib/trackLibrary";

// Starts an own recording: the form's song data (title, key, tempo, sections,
// stems) plus the list of audio files; the files themselves go to
// /api/tracks/own/[id]. Checks everything first, so a typo shows up here
// and not as a failed conversion later.
export async function POST(req: NextRequest) {
  const authSession = await isAuthorized(req, undefined, "tracks");
  if (!authSession) return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
  try {
    const body = await req.json();
    const { id, resumed } = await createOwn(body, authSession.username);
    return NextResponse.json({ id, resumed, chunkSize: CHUNK_SIZE });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
