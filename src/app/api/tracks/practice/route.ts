export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { isPracticeAuthorized } from "@/lib/practiceAuth";
import { listTracks } from "@/lib/trackLibrary";
import { ensurePracticeVersions, practiceState } from "@/lib/trackPractice";
import { getDraftServices, getDraftService } from "@/lib/draftServicesStore";
import { matchSong } from "@/lib/trackSongMatch";

function todayInAmsterdam(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Amsterdam" }).format(new Date());
}

const songName = (fileName: string, rpp?: string) =>
  (rpp ? rpp.split("/").pop()! : fileName).replace(/\.(rpp|zip)$/i, "");

// Songs that can be practised plus the setlist of the next service.
export async function GET(req: NextRequest) {
  if (!(await isPracticeAuthorized(req))) {
    return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
  }
  const items = listTracks().filter(i => i.status !== "uploading");
  ensurePracticeVersions(items);

  const songs = items
    .map(i => {
      const p = practiceState(i.id);
      return { id: i.id, name: songName(i.fileName, i.report?.rpp), status: p?.status || "queued", message: p?.message || null };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  // Setlist: same matching as the Tracks tab (title prefix, manual links)
  const today = todayInAmsterdam();
  const dates = getDraftServices().map(s => s.serviceDate);
  const requested = req.nextUrl.searchParams.get("date");
  const date = requested && dates.includes(requested) ? requested : dates.find(d => d >= today) || null;
  const candidates = items.map(i => ({ name: songName(i.fileName, i.report?.rpp), path: i.report?.rpp || i.id, id: i.id }));
  const setlist = date
    ? (getDraftService(date)?.songs || []).map(s => {
        const match = matchSong(s.title, candidates);
        const hit = candidates.find(c => c.path === match.path);
        return { title: s.title, artist: s.artist || "", id: hit?.id || null };
      })
    : [];

  return NextResponse.json({ songs, date, dates: dates.filter(d => d >= today), setlist });
}
