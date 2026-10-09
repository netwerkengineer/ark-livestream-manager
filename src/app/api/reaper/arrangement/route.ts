export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/authHelper";
import { hasDesktopAccess, DESKTOP_COOKIE } from "@/lib/desktopAccess";
import { getSettings } from "@/lib/settingsStore";
import { getBridgeState, getSongSections, sendBridgeCommand, type SongSection } from "@/lib/reaperControl";
import {
  findShowForSong,
  getStoredArrangement,
  isInstrumental,
  readShow,
  saveArrangement,
  searchSongShows,
  showGroups,
  suggestMapping,
  type SectionMapping,
} from "@/lib/trackArrangement";

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

async function knownSong(path: unknown): Promise<string> {
  const bridge = await getBridgeState();
  if (!bridge) throw new Error("REAPER-bridge draait niet");
  if (typeof path !== "string" || !bridge.songs.some(s => s.path === path)) throw new Error("Onbekende song");
  return path;
}

// The desktop app plays on its own computer and knows the sections itself; it sends them along and
// gets the cue table back to give to its own engine (no REAPER bridge involved).
function givenSections(raw: unknown): SongSection[] | null {
  if (!Array.isArray(raw)) return null;
  const list = raw.filter((s): s is SongSection => !!s && typeof s.id === "number" && typeof s.name === "string" && typeof s.start === "number");
  return list.length ? list : null;
}

// GET ?search=  -> song shows in the FreeShow catalogue
// GET ?path=&title=&artist=[&show=]  -> sections of the track, lyric groups of
//   the show and the saved (or proposed) mapping between them
async function readArrangement(a: { path: string; title: string; artist: string; show: string | null; sections: SongSection[] | null }) {
  const stored = await getStoredArrangement(a.path);
  const sections = a.sections ?? await getSongSections(a.path);
  const showFile = a.show
    || stored?.showFile
    || await findShowForSong(a.title, a.artist);

  let groups: ReturnType<typeof showGroups> = [];
  let showName: string | null = null;
  if (showFile) {
    const { show } = await readShow(showFile);
    groups = showGroups(show);
    showName = show.name || showFile.replace(/\.show$/, "");
  }
  const names = sections.map(s => s.name);
  const useStored = !!stored && stored.showFile === showFile;
  const mapping: SectionMapping = useStored ? stored.mapping : suggestMapping(names, groups);

  return {
    sections,
    instrumental: [...new Set(names)].filter(isInstrumental),
    showFile,
    showName,
    groups,
    mapping,
    saved: useStored ? { at: stored.updatedAt, by: stored.updatedBy } : null,
    suggestion: suggestMapping(names, groups),
  };
}

export async function GET(req: NextRequest) {
  const authSession = await isAuthorized(req, undefined, "tracks");
  if (!authSession) return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
  if (!getSettings().reaperEnabled) return NextResponse.json({ error: "Tracks (REAPER) is uitgeschakeld" }, { status: 409 });

  const params = req.nextUrl.searchParams;
  try {
    if (params.has("search")) {
      return NextResponse.json({ shows: await searchSongShows(params.get("search") || "") });
    }

    const path = await knownSong(params.get("path"));
    return NextResponse.json(await readArrangement({
      path, title: params.get("title") || "", artist: params.get("artist") || "", show: params.get("show"), sections: null,
    }));
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 502 });
  }
}

// POST {path, showFile, mapping} -> Tracks layout in the FreeShow show + cue
// table to the bridge
export async function POST(req: NextRequest) {
  const authSession = await isAuthorized(req, undefined, "tracks");
  if (!authSession) return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
  if (!getSettings().reaperEnabled) return NextResponse.json({ error: "Tracks (REAPER) is uitgeschakeld" }, { status: 409 });

  try {
    const body = await req.json();
    const { path: rawPath, showFile, mapping } = body;
    const given = givenSections(body.sections);
    if (given && !hasDesktopAccess(req.headers.get("user-agent"), req.cookies.get(DESKTOP_COOKIE)?.value)) {
      return NextResponse.json({ error: "Alleen voor de desktop-app" }, { status: 403 });
    }
    // desktop app: read the arrangement of a song it has (sections come from its own engine)
    if (body.action === "read") {
      if (!given || typeof rawPath !== "string") return NextResponse.json({ error: "Secties ontbreken" }, { status: 400 });
      return NextResponse.json(await readArrangement({ path: rawPath, title: String(body.title || ""), artist: String(body.artist || ""), show: typeof body.show === "string" ? body.show : null, sections: given }));
    }
    const path = given && typeof rawPath === "string" ? rawPath : await knownSong(rawPath);
    if (typeof showFile !== "string" || !showFile) return NextResponse.json({ error: "Kies een FreeShow-show" }, { status: 400 });
    if (!mapping || typeof mapping !== "object") return NextResponse.json({ error: "Geen koppeling" }, { status: 400 });
    const clean: SectionMapping = {};
    for (const [name, ids] of Object.entries(mapping)) {
      if (Array.isArray(ids)) clean[name] = ids.filter((id): id is string => typeof id === "string");
    }

    const sections = given ?? await getSongSections(path);
    const result = await saveArrangement(path, showFile, sections, clean, authSession.username);
    if (given) return NextResponse.json({ success: true, slides: result.slides, warnings: result.warnings, cues: result.cues });
    await sendBridgeCommand("cues", [path, result.cues]);
    return NextResponse.json({ success: true, slides: result.slides, warnings: result.warnings });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 502 });
  }
}
