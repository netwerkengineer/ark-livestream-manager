import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';
import { isAuthorized } from '@/lib/authHelper';
import { getSongMeta } from '@/lib/songMetaStore';

const CONTENT_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8'
};

// Serves one song's chords for the catalog list's "open akkoorden" button -
// either the uploaded chord chart verbatim, or the free-text chords rendered
// as a plain-text file on the fly. Always opened by a normal browser
// navigation (target="_blank"), so the existing cookie session covers auth
// the same way it would for any other page in the app.
export async function GET(req: NextRequest) {
  const authSession = await isAuthorized(req, undefined, 'freeshow');
  if (!authSession) {
    return NextResponse.json({ error: 'Niet geautoriseerd' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const title = searchParams.get('title');
  const artist = searchParams.get('artist') || undefined;
  if (!title) {
    return NextResponse.json({ success: false, error: 'Titel is verplicht' }, { status: 400 });
  }

  const meta = getSongMeta(title, artist);
  if (!meta || (!meta.chordsFilePath && !meta.chordsText)) {
    return NextResponse.json({ success: false, error: 'Geen akkoorden gevonden voor dit lied' }, { status: 404 });
  }

  try {
    if (meta.chordsFilePath) {
      const ext = path.extname(meta.chordsFileName || meta.chordsFilePath).toLowerCase();
      const buffer = await readFile(meta.chordsFilePath);
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          'Content-Type': CONTENT_TYPES[ext] || 'application/octet-stream',
          'Content-Disposition': `inline; filename="${(meta.chordsFileName || 'akkoorden').replace(/"/g, '')}"`
        }
      });
    }

    const lines = [artist ? `${title} - ${artist}` : title, '', meta.chordsText || ''];
    return new NextResponse(lines.join('\n'), {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `inline; filename="${title} (akkoorden).txt"`
      }
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
