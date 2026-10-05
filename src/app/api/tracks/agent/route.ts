export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { isAgentAuthorized } from "@/lib/trackAgentAuth";
import { listTracks, setTrackStatus, getTrack, type TrackStatus } from "@/lib/trackLibrary";
import { neededTrackIds } from "@/lib/trackCache";

// Polled by ark_tracks_agent.py on the track computer: every uploaded track
// it should have (so it can also restore a reinstalled Mac), plus the ids
// removed on the server.
export async function GET(req: NextRequest) {
  if (!isAgentAuthorized(req)) {
    return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
  }
  const all = listTracks(true);
  const needed = neededTrackIds(all.filter(i => i.status !== "deleted"));
  return NextResponse.json({
    items: all
      .filter(i => i.status !== "uploading" && i.status !== "deleted")
      // needed = keep / fetch the audio on the track computer
      .map(i => ({ id: i.id, fileName: i.fileName, size: i.size, status: i.status, message: i.message, needed: needed.has(i.id), hasProject: !!i.report?.rpp })),
    deleted: all.filter(i => i.status === "deleted").map(i => i.id),
  });
}

const AGENT_STATUSES: TrackStatus[] = ["downloading", "converting", "ready", "error"];

export async function POST(req: NextRequest) {
  if (!isAgentAuthorized(req)) {
    return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
  }
  try {
    const { id, status, message, report, local } = await req.json();
    const item = typeof id === "string" ? getTrack(id) : undefined;
    if (!item || item.status === "deleted") {
      return NextResponse.json({ error: "Track niet gevonden" }, { status: 404 });
    }
    // Only the local audio state changed (audio removed / fetched again)
    if (status === undefined && (local === "full" || local === "slim")) {
      await setTrackStatus(id, { local });
      return NextResponse.json({ success: true });
    }
    if (!AGENT_STATUSES.includes(status)) {
      return NextResponse.json({ error: "Ongeldige status" }, { status: 400 });
    }
    await setTrackStatus(id, {
      ...(local === "full" || local === "slim" ? { local } : {}),
      status,
      message: typeof message === "string" ? message.slice(0, 500) : undefined,
      report: report && typeof report === "object" ? report : undefined,
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
