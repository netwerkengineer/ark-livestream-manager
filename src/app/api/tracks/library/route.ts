export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/authHelper";
import { listTracks, getTrack, setTrackStatus, deleteTrack, getAgentInfo, receivedBytes } from "@/lib/trackLibrary";
import { neededTrackIds } from "@/lib/trackCache";
import { logActivity } from "@/lib/activityLog";

export async function GET(req: NextRequest) {
  const authSession = await isAuthorized(req, undefined, "tracks");
  if (!authSession) {
    return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
  }
  const needed = neededTrackIds();
  const items = listTracks()
    .map(i => ({ ...i, needed: needed.has(i.id), ...(i.status === "uploading" ? { received: receivedBytes(i.id) } : {}) }))
    .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  return NextResponse.json({ items, agent: getAgentInfo() });
}

export async function POST(req: NextRequest) {
  const authSession = await isAuthorized(req, undefined, "tracks");
  if (!authSession) {
    return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
  }
  try {
    const { action, id, value } = await req.json();
    const item = typeof id === "string" ? getTrack(id) : undefined;
    if (!item || item.status === "deleted") {
      return NextResponse.json({ error: "Track niet gevonden" }, { status: 404 });
    }
    if (action === "retry") {
      if (item.status !== "error") return NextResponse.json({ error: "Alleen mislukte tracks opnieuw proberen" }, { status: 400 });
      await setTrackStatus(id, { status: "stored", message: "Wacht op de track-computer" });
    } else if (action === "pin") {
      await setTrackStatus(id, { pinned: !!value });
    } else if (action === "delete") {
      await deleteTrack(id);
      logActivity("system", `Track "${item.fileName}" verwijderd door ${authSession.username}.`);
    } else {
      return NextResponse.json({ error: "Onbekende actie" }, { status: 400 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
