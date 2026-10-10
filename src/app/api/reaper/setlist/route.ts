export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/authHelper";
import { getSettings } from "@/lib/settingsStore";
import { getDraftServices, getDraftService } from "@/lib/draftServicesStore";
import { getBridgeState, sendBridgeCommand, type BridgeSong } from "@/lib/reaperControl";
import { matchSong, saveSongLink } from "@/lib/trackSongMatch";
import { isDesktopBackend, playerState, sendCommand, checkCommand, deviceLabel } from "@/lib/desktopLink";
import { getStoredArrangement, rebuildIfShowChanged } from "@/lib/trackArrangement";
import { listTracks } from "@/lib/trackLibrary";
import { hasDesktopAccess, DESKTOP_COOKIE } from "@/lib/desktopAccess";

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

function resolveDate(requested: string | null) {
  const today = todayInAmsterdam();
  const services = getDraftServices();
  const dates = services.map(s => s.serviceDate);
  const hasSongs = (d: string) => (services.find(s => s.serviceDate === d)?.songs?.length ?? 0) > 0;
  // without a choice: the next service that has songs (a service without songs is not worth opening first), else the next one
  const date = requested && dates.includes(requested)
    ? requested
    : dates.find(d => d >= today && hasSongs(d)) || dates.find(d => d >= today) || dates[dates.length - 1] || null;
  return { today, dates, date };
}

// The service setlist (Planner / liturgy mail) matched to the songs on the
// track computer. Defaults to the first service from today on.
export async function GET(req: NextRequest) {
  const authSession = await isAuthorized(req, undefined, "tracks");
  if (!authSession) {
    return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
  }
  if (isDesktopBackend()) {
    // the setlist the desktop app reports (its own list or the service, with the paths of that computer)
    const p = playerState();
    if (!p.online || !p.setlist) return NextResponse.json({ error: "Desktop-app niet verbonden" }, { status: 502 });
    // another service picked in the stage view: matched to the songs on the app's computer here on the server
    // (the app itself keeps showing its own date until a setlist is loaded)
    const snap = p.setlist as { own?: boolean; songs?: BridgeSong[]; loaded?: string[] };
    const wanted = req.nextUrl.searchParams.get("date");
    const bridge = (p.state as { bridge?: { songs?: BridgeSong[]; setlist?: string[] } } | null)?.bridge;
    if (wanted && !snap.own) {
      const songs = bridge?.songs || snap.songs || [];
      const r = resolveDate(wanted);
      return NextResponse.json({ ...snap, ...r, setlist: r.date ? setlistFor(r.date, songs) : [], songs, loaded: bridge?.setlist ?? snap.loaded ?? [], bridgeError: null });
    }
    return NextResponse.json(p.setlist);
  }
  if (!getSettings().reaperEnabled) {
    return NextResponse.json({ error: "Tracks (REAPER) is uitgeschakeld" }, { status: 409 });
  }

  const { today, dates, date } = resolveDate(req.nextUrl.searchParams.get("date"));

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
  if (isDesktopBackend()) {
    const peek = await req.clone().json().catch(() => ({}));
    if (peek?.action !== "match") {      // "match" is the app itself asking for its service list
      const bad = checkCommand("setlist", peek || {});
      if (bad) return NextResponse.json({ error: bad === "Dit kan niet vanaf afstand" ? "Koppelen kan alleen in de desktop-app" : bad }, { status: 400 });
      try {
        await sendCommand("setlist", peek, authSession.username, deviceLabel(req.headers.get("user-agent")));
        return NextResponse.json({ success: true });
      } catch (err) {
        return NextResponse.json({ error: errorMessage(err) }, { status: 502 });
      }
    }
  }
  if (!getSettings().reaperEnabled && !hasDesktopAccess(req.headers.get("user-agent"), req.cookies.get(DESKTOP_COOKIE)?.value)) {   // the desktop app plays on its own computer
    return NextResponse.json({ error: "Tracks (REAPER) is uitgeschakeld" }, { status: 409 });
  }

  try {
    const body = await req.json();
    const { action, title, path, date } = body;

    // The desktop app plays on its own computer: it sends the songs it has, we match the service
    // setlist to them (the same matching as for the track computer; no REAPER bridge needed)
    if (action === "match") {
      if (!hasDesktopAccess(req.headers.get("user-agent"), req.cookies.get(DESKTOP_COOKIE)?.value)) {
        return NextResponse.json({ error: "Alleen voor de desktop-app" }, { status: 403 });
      }
      const songs: BridgeSong[] = (Array.isArray(body.songs) ? body.songs : [])
        .filter((s: unknown): s is BridgeSong => !!s && typeof (s as BridgeSong).name === "string" && typeof (s as BridgeSong).path === "string");
      const loaded: string[] = (Array.isArray(body.loaded) ? body.loaded : []).filter((p: unknown): p is string => typeof p === "string");
      const r = resolveDate(typeof date === "string" ? date : null);
      return NextResponse.json({ ...r, setlist: r.date ? setlistFor(r.date, songs) : [], songs, loaded, bridgeError: null });
    }

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
