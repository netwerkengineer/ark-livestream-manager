import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized } from '@/lib/authHelper';
import { addScriptureToDraft } from '@/lib/draftServicesStore';

// Adds one Bible reading to a setlist being built directly in the app - the
// worship-leader-facing counterpart to what the e-mail parser does for
// "[Bijbeltekst] Boek H:V-V" lines.
export async function POST(req: NextRequest, { params }: { params: Promise<{ serviceDate: string }> }) {
  const authSession = await isAuthorized(req, undefined, 'freeshow');
  if (!authSession) {
    return NextResponse.json({ error: 'Niet geautoriseerd' }, { status: 401 });
  }

  const { serviceDate } = await params;
  try {
    const body = await req.json();
    const { book, chapter, verseStart, verseEnd, translation, section } = body;
    if (!book || typeof book !== 'string' || !book.trim()) {
      return NextResponse.json({ success: false, error: 'Boek is verplicht' }, { status: 400 });
    }
    if (!chapter || !verseStart) {
      return NextResponse.json({ success: false, error: 'Hoofdstuk en vers zijn verplicht' }, { status: 400 });
    }
    if (!translation || typeof translation !== 'string' || !translation.trim()) {
      return NextResponse.json({ success: false, error: 'Vertaling is verplicht' }, { status: 400 });
    }
    if (!section || typeof section !== 'string' || !section.trim()) {
      return NextResponse.json({ success: false, error: 'Sectie is verplicht' }, { status: 400 });
    }

    const draft = addScriptureToDraft(serviceDate, {
      book: book.trim(),
      chapter: Number(chapter),
      verseStart: Number(verseStart),
      verseEnd: verseEnd ? Number(verseEnd) : undefined,
      translation: translation.trim(),
      section: section.trim()
    });
    return NextResponse.json({ success: true, draft });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
