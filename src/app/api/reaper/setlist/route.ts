export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/authHelper";
import { getSettings } from "@/lib/settingsStore";
import { getDraftServices, getDraftService } from "@/lib/draftServicesStore";
import { getBridgeState, sendBridgeCommand, type BridgeSong } from "@/lib/reaperControl";
import { matchSong, saveSongLink } from "@/lib/trackSongMatch";
import { getStoredArrangement, rebuildIfShowChanged } from "@/lib/trackArrangement";
import { listTracks } from "@/lib/trackLibrary";

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

function todayInAmsterdam(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Amsterdam" }).format(new Date());
}

function setlistFor(serviceDate: string, songs: BridgeSong[]) {
  const draft = getDraftService(serviceDate);
  const library = listTracks();
  return (draft?.songs || []).map(s => {
    const match = matchSong(s.title, songs);
    // "slim" = audio not on the track computer (only on the server, being fetched)
    const local = match.path ? library.find(i => i.report?.rpp === match.path)?.local ?? null : null;
    return {
      id: s.id,
      title: s.title,
      artist: s.artist || "",
      section: s.section,
      path: match.path,
      manual: match.manual,
      local,
    };
  });
}

// The service setlist (Planner / liturgy mail) matched to the songs on the
// track computer. Defaults to the first service from today on.
export async function GET(req: NextRequest) {
  const authSession = await isAuthorized(req, undefined, "tracks");
  if (!authSession) {
    return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
  }
  if (!getSettings().reaperEnabled) {
    return NextResponse.json({ error: "Tracks (REAPER) is uitgeschakeld" }, { status: 409 });
  }

  const today = todayInAmsterdam();
  const dates = getDraftServices().map(s => s.serviceDate);
  const requested = req.nextUrl.searchParams.get("date");
  const date = requested && dates.includes(requested)
    ? requested
    : dates.find(d => d >= today) || dates[dates.length - 1] || null;

  let songs: BridgeSong[] = [];
  let loaded: string[] = [];
  let bridgeError: string | null = null;
  try {
    const bridge = await getBridgeState();
    if (bridge) {
      songs = bridge.songs;
      loaded = bridge.setlist;
    } else {
      bridgeError = "REAPER-bridge draait niet (ark_tracks_bridge.lua)";
    }
  } catch (err) {
    bridgeError = `REAPER niet bereikbaar: ${errorMessage(err)}`;
  }

  return NextResponse.json({
    today,
    dates,
    date,
    setlist: date ? setlistFor(date, songs) : [],
    songs,
    loaded,
    bridgeError,
  });
}

export async function POST(req: NextRequest) {
  const authSession = await isAuthorized(req, undefined, "tracks");
  if (!authSession) {
    return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
  }
  if (!getSettings().reaperEnabled) {
    return NextResponse.json({ error: "Tracks (REAPER) is uitgeschakeld" }, { status: 409 });
  }

  try {
    const { action, title, path, date } = await req.json();
    const bridge = await getBridgeState();
    if (!bridge) return NextResponse.json({ error: "REAPER-bridge draait niet" }, { status: 502 });

    if (action === "link") {
      if (typeof title !== "string" || !title.trim()) {
        return NextResponse.json({ error: "Titel ontbreekt" }, { status: 400 });
      }
      if (path !== null && !bridge.songs.some(s => s.path === path)) {
        return NextResponse.json({ error: "Onbekende song" }, { status: 400 });
      }
      saveSongLink(title, path);
      return NextResponse.json({ success: true });
    }

    if (action === "load") {
      if (typeof date !== "string" || !getDraftService(date)) {
        return NextResponse.json({ error: "Onbekende dienst" }, { status: 400 });
      }
      const paths = setlistFor(date, bridge.songs).map(s => s.path).filter((p): p is string => !!p);
      if (paths.length === 0) {
        return NextResponse.json({ error: "Geen songs uit deze setlist gevonden op de track-computer" }, { status: 400 });
      }
      // Opening several projects can take a while
      await sendBridgeCommand("setlist", paths, 60000);
      // Cue tables again, in case the bridge's copy (next to the project on the
      // track computer) is missing, e.g. after a reinstall
      for (const p of paths) {
        const rebuilt = await rebuildIfShowChanged(p).catch(() => false);
        const stored = await getStoredArrangement(p);
        if (stored && !rebuilt) await sendBridgeCommand("cues", [p, stored.cues]).catch(() => undefined);
      }
      return NextResponse.json({ success: true, loaded: paths.length });
    }

    return NextResponse.json({ error: "Onbekende actie" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 502 });
  }
}
