import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized } from '@/lib/authHelper';
import { addSongToDraft } from '@/lib/draftServicesStore';

// Adds one song to a setlist being built directly in the app (as opposed to
// one parsed from a liturgie mail) - the worship-leader-facing counterpart
// to what mergeParsedEmailIntoDraft does for the email pipeline.
export async function POST(req: NextRequest, { params }: { params: Promise<{ serviceDate: string }> }) {
  const authSession = await isAuthorized(req, undefined, 'freeshow');
  if (!authSession) {
    return NextResponse.json({ error: 'Niet geautoriseerd' }, { status: 401 });
  }

  const { serviceDate } = await params;
  try {
    const body = await req.json();
    const { title, artist, category, section, lyricsText, chordsText } = body;
    if (!title || typeof title !== 'string' || !title.trim()) {
      return NextResponse.json({ success: false, error: 'Titel is verplicht' }, { status: 400 });
    }
    if (!section || typeof section !== 'string' || !section.trim()) {
      return NextResponse.json({ success: false, error: 'Sectie is verplicht' }, { status: 400 });
    }
    const draft = addSongToDraft(serviceDate, { title: title.trim(), artist, category, section, lyricsText, chordsText });
    return NextResponse.json({ success: true, draft });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
