import { getDraftServices } from './draftServicesStore';
import { getSettings } from './settingsStore';
import { listTracks, type TrackItem } from './trackLibrary';
import { matchSong } from './trackSongMatch';

// Which uploaded songs the track computer should keep with audio. The server
// keeps every zip; the Mac mini only needs the songs that are about to be
// played: everything on upcoming setlists (worship leaders send them on
// Wednesday, the agent fetches within minutes), songs played in the last
// weeks (they tend to come back) and songs pinned in the library. For the
// rest the agent removes only the audio - the REAPER project with its mix and
// lyric blocks stays, and the audio comes back when the song is needed again.

function todayInAmsterdam(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam' }).format(new Date());
}

function daysBefore(date: string, days: number): string {
  const d = new Date(date + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export function neededTrackIds(items: TrackItem[] = listTracks()): Set<string> {
  const weeks = getSettings().trackKeepWeeks ?? 8;
  const from = daysBefore(todayInAmsterdam(), weeks * 7);
  // The songs as the setlist matching knows them: REAPER project paths
  const songs = items
    .filter(i => i.report?.rpp)
    .map(i => ({ name: (i.report!.rpp!.split('/').pop() || '').replace(/\.rpp$/i, ''), path: i.report!.rpp! }));
  const neededPaths = new Set<string>();
  for (const service of getDraftServices()) {
    if (service.serviceDate < from) continue;
    for (const song of service.songs) {
      const match = matchSong(song.title, songs);
      if (match.path) neededPaths.add(match.path);
    }
  }
  // Unknown project path (e.g. a lost status report): count it as needed -
  // when in doubt, never remove audio
  return new Set(items.filter(i => i.pinned || !i.report?.rpp || neededPaths.has(i.report.rpp)).map(i => i.id));
}
