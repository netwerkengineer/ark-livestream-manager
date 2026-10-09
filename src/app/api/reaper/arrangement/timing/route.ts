export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/authHelper";
import { hasDesktopAccess, DESKTOP_COOKIE } from "@/lib/desktopAccess";
import { getSettings } from "@/lib/settingsStore";
import { getBridgeState, sendBridgeCommand, type SongSection } from "@/lib/reaperControl";
import { getTimingData, saveRecordedTimings, saveSectionTiming } from "@/lib/trackArrangement";

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

async function knownSong(path: unknown): Promise<string> {
  const bridge = await getBridgeState();
  if (!bridge) throw new Error("REAPER-bridge draait niet");
  if (typeof path !== "string" || !bridge.songs.some(s => s.path === path)) throw new Error("Onbekende song");
  return path;
}

// GET ?path=  -> per section the slides with the moment they appear now (beats from the section start)
export async function GET(req: NextRequest) {
  const authSession = await isAuthorized(req, undefined, "tracks");
  if (!authSession) return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
  if (!getSettings().reaperEnabled) return NextResponse.json({ error: "Tracks (REAPER) is uitgeschakeld" }, { status: 409 });
  try {
    const path = await knownSong(req.nextUrl.searchParams.get("path"));
    return NextResponse.json(await getTimingData(path));
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 502 });
  }
}

function givenSections(raw: unknown): SongSection[] | null {
  if (!Array.isArray(raw)) return null;
  const list = raw.filter((s): s is SongSection => !!s && typeof s.id === "number" && typeof s.name === "string" && typeof s.start === "number");
  return list.length ? list : null;
}

// POST {path, name, at} -> save the timing of one section; at = {"2": beat, "3": beat, ...} or null (back to the estimate)
// Desktop app (it sends its own sections and gets the cue table back for its engine):
//   {action: "read", path, sections, lead} | {action: "recorded", path, sections, taps} | {path, name, at, sections}
export async function POST(req: NextRequest) {
  const authSession = await isAuthorized(req, undefined, "tracks");
  if (!authSession) return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
  if (!getSettings().reaperEnabled) return NextResponse.json({ error: "Tracks (REAPER) is uitgeschakeld" }, { status: 409 });
  try {
    const body = await req.json();
    const { path: rawPath, name, at } = body;
    const given = givenSections(body.sections);
    const lead = typeof body.lead === "number" ? body.lead : 2;
    if (given) {
      if (!hasDesktopAccess(req.headers.get("user-agent"), req.cookies.get(DESKTOP_COOKIE)?.value)) {
        return NextResponse.json({ error: "Alleen voor de desktop-app" }, { status: 403 });
      }
      if (typeof rawPath !== "string") return NextResponse.json({ error: "Onbekende song" }, { status: 400 });
      if (body.action === "read") return NextResponse.json(await getTimingData(rawPath, { sections: given, lead }));
      if (body.action === "recorded") {
        const result = await saveRecordedTimings(rawPath, body.taps || {}, authSession.username, given);
        return NextResponse.json({ success: true, slides: result.slides, warnings: result.warnings, cues: result.cues, sections: result.sections });
      }
      if (typeof name !== "string" || !name) return NextResponse.json({ error: "Sectie ontbreekt" }, { status: 400 });
      if (at !== null && (typeof at !== "object" || Array.isArray(at))) return NextResponse.json({ error: "Ongeldige timing" }, { status: 400 });
      const result = await saveSectionTiming(rawPath, name, at, authSession.username, { sections: given, lead });
      return NextResponse.json({ success: true, slides: result.slides, warnings: result.warnings, cues: result.cues });
    }
    const path = await knownSong(rawPath);
    if (typeof name !== "string" || !name) return NextResponse.json({ error: "Sectie ontbreekt" }, { status: 400 });
    if (at !== null && (typeof at !== "object" || Array.isArray(at))) return NextResponse.json({ error: "Ongeldige timing" }, { status: 400 });
    const result = await saveSectionTiming(path, name, at, authSession.username);
    await sendBridgeCommand("cues", [path, result.cues]);
    return NextResponse.json({ success: true, slides: result.slides, warnings: result.warnings });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 400 });
  }
}
