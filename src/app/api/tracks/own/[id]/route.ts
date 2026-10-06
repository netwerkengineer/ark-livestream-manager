export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/authHelper";
import { getTrack, CHUNK_SIZE } from "@/lib/trackLibrary";
import { ownReceived, appendOwnChunk, completeOwn, readMeta } from "@/lib/trackOwn";
import { enqueuePractice } from "@/lib/trackPractice";
import { logActivity } from "@/lib/activityLog";

type Params = { params: Promise<{ id: string }> };

async function ownItem(req: NextRequest, params: Params["params"]) {
  const authSession = await isAuthorized(req, undefined, "tracks");
  if (!authSession) return { error: NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 }) };
  const { id } = await params;
  const item = getTrack(id);
  if (!item || !item.own || item.status !== "uploading") {
    return { error: NextResponse.json({ error: "Upload niet gevonden of al afgerond" }, { status: 404 }) };
  }
  return { item, authSession };
}

// Bytes received per file - to resume an interrupted upload
export async function GET(req: NextRequest, { params }: Params) {
  const { item, error } = await ownItem(req, params);
  if (error) return error;
  return NextResponse.json({ received: ownReceived(item.id), sizes: readMeta(item.id)?.files.map(f => f.size) });
}

// POST ?file=<index>&offset=N with raw bytes: one chunk of that file.
// POST ?complete=1: everything is in - zip it and hand it over.
export async function POST(req: NextRequest, { params }: Params) {
  const { item, authSession, error } = await ownItem(req, params);
  if (error) return error;

  if (req.nextUrl.searchParams.get("complete") === "1") {
    try {
      await completeOwn(item.id);
      enqueuePractice(item.id);
      logActivity("system", `Eigen opname "${item.fileName}" toegevoegd door ${authSession.username}.`);
      return NextResponse.json({ success: true });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
    }
  }

  const index = Number(req.nextUrl.searchParams.get("file"));
  const offset = Number(req.nextUrl.searchParams.get("offset"));
  const data = Buffer.from(await req.arrayBuffer());
  if (!Number.isInteger(index) || !Number.isInteger(offset) || data.length === 0 || data.length > CHUNK_SIZE) {
    return NextResponse.json({ error: "Ongeldig stuk" }, { status: 400 });
  }
  try {
    return NextResponse.json({ received: appendOwnChunk(item.id, index, offset, data) });
  } catch (err) {
    const expected = (err as { expected?: number }).expected;
    if (expected !== undefined) return NextResponse.json({ error: "Verkeerde positie", received: expected }, { status: 409 });
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
