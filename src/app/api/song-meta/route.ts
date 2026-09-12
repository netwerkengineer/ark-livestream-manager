import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized } from '@/lib/authHelper';
import { getSongMeta, getAllSongMeta, setSongMeta } from '@/lib/songMetaStore';

// Chords/YouTube-link lookup for one song, by title+artist - used to
// pre-fill the setlist builder's staging panel and the show editor's
// Akkoorden/YouTube-link fields when a song already has these saved.
// Called with no `title` at all, it instead returns the whole store in one
// go - used by the catalog list to show a YouTube/akkoorden button per show
// card without a lookup per card.
export async function GET(req: NextRequest) {
  const authSession = await isAuthorized(req, undefined, 'freeshow');
  if (!authSession) {
    return NextResponse.json({ error: 'Niet geautoriseerd' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const title = searchParams.get('title');
  const artist = searchParams.get('artist') || undefined;

  try {
    if (!title) {
      return NextResponse.json({ success: true, all: getAllSongMeta() });
    }
    const meta = getSongMeta(title, artist);
    return NextResponse.json({ success: true, meta });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// Upserts chords/YouTube-link for one song - called both from the show
// editor (deliberate, per-song maintenance) and from the setlist builder
// (typing chords while building a Sunday's setlist saves them for next time
// too), since this store is our own and isn't at risk of being overwritten
// by anything FreeShow itself does to its .show files.
export async function POST(req: NextRequest) {
  const authSession = await isAuthorized(req, undefined, 'freeshow');
  if (!authSession) {
    return NextResponse.json({ error: 'Niet geautoriseerd' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { title, artist, chordsText, chordsFileName, chordsFilePath, youtubeUrl } = body;
    if (!title || typeof title !== 'string' || !title.trim()) {
      return NextResponse.json({ success: false, error: 'Titel is verplicht' }, { status: 400 });
    }
    const meta = setSongMeta(title, artist, { chordsText, chordsFileName, chordsFilePath, youtubeUrl });
    return NextResponse.json({ success: true, meta });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
