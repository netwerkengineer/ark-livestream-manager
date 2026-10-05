export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/authHelper";
import { getTrack, receivedBytes, appendChunk, completeUpload, CHUNK_SIZE } from "@/lib/trackLibrary";
import { logActivity } from "@/lib/activityLog";

type Params = { params: Promise<{ id: string }> };

async function uploadingItem(req: NextRequest, params: Params["params"]) {
  const authSession = await isAuthorized(req, undefined, "tracks");
  if (!authSession) return { error: NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 }) };
  const { id } = await params;
  const item = getTrack(id);
  if (!item || item.status !== "uploading") {
    return { error: NextResponse.json({ error: "Upload niet gevonden of al afgerond" }, { status: 404 }) };
  }
  return { item, authSession };
}

// How much has arrived - used to resume an interrupted upload.
export async function GET(req: NextRequest, { params }: Params) {
  const { item, error } = await uploadingItem(req, params);
  if (error) return error;
  return NextResponse.json({ received: receivedBytes(item.id), size: item.size });
}

// POST ?offset=N with raw bytes: one chunk, appended at that offset.
// POST ?complete=1: all chunks are in - check and hand over to the track
// computer. (POST rather than PUT: the reverse proxy only allows
// GET/POST/HEAD/DELETE for this site.)
export async function POST(req: NextRequest, { params }: Params) {
  const { item, authSession, error } = await uploadingItem(req, params);
  if (error) return error;
  if (req.nextUrl.searchParams.get("complete") === "1") {
    try {
      const done = await completeUpload(item.id);
      logActivity("system", `Track "${item.fileName}" geüpload door ${authSession.username}.`);
      return NextResponse.json({ success: true, item: done });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
    }
  }

  const offset = Number(req.nextUrl.searchParams.get("offset"));
  const data = Buffer.from(await req.arrayBuffer());
  if (!Number.isInteger(offset) || data.length === 0 || data.length > CHUNK_SIZE || offset + data.length > item.size) {
    return NextResponse.json({ error: "Ongeldig stuk" }, { status: 400 });
  }
  try {
    return NextResponse.json({ received: appendChunk(item.id, offset, data) });
  } catch (err) {
    const expected = (err as { expected?: number }).expected;
    if (expected !== undefined) {
      return NextResponse.json({ error: "Verkeerde positie", received: expected }, { status: 409 });
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
