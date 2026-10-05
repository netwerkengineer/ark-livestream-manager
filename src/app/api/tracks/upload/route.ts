export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/authHelper";
import { createUpload, CHUNK_SIZE, MAX_TRACK_SIZE } from "@/lib/trackLibrary";

// Starts a chunked upload of a MultiTracks zip; the chunks themselves go to
// /api/tracks/upload/[id].
export async function POST(req: NextRequest) {
  const authSession = await isAuthorized(req, undefined, "tracks");
  if (!authSession) {
    return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
  }
  try {
    const { fileName, size } = await req.json();
    if (typeof fileName !== "string" || !/\.zip$/i.test(fileName)) {
      return NextResponse.json({ error: "Kies het .zip-bestand van MultiTracks" }, { status: 400 });
    }
    if (!Number.isInteger(size) || size <= 0 || size > MAX_TRACK_SIZE) {
      return NextResponse.json({ error: "Ongeldige bestandsgrootte (max 4 GB)" }, { status: 400 });
    }
    const item = await createUpload(fileName, size, authSession.username);
    return NextResponse.json({ id: item.id, chunkSize: CHUNK_SIZE });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
