import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized } from '@/lib/authHelper';
import { addMediaToDraft } from '@/lib/draftServicesStore';

// Adds one media item (YouTube link, uploaded file, or plain link) to a
// setlist being built directly in the app - the worship-leader-facing
// counterpart to what the e-mail parser does for a Media block. File
// uploads themselves go through the existing /api/upload route first; this
// route just records the resulting path against the draft.
export async function POST(req: NextRequest, { params }: { params: Promise<{ serviceDate: string }> }) {
  const authSession = await isAuthorized(req, undefined, 'freeshow');
  if (!authSession) {
    return NextResponse.json({ error: 'Niet geautoriseerd' }, { status: 401 });
  }

  const { serviceDate } = await params;
  try {
    const body = await req.json();
    const { mediaType, url, attachmentName, filePath, section } = body;
    if (!['youtube', 'attachment', 'link'].includes(mediaType)) {
      return NextResponse.json({ success: false, error: 'Ongeldig media-type' }, { status: 400 });
    }
    if (mediaType === 'attachment' && !filePath) {
      return NextResponse.json({ success: false, error: 'Bestand is verplicht' }, { status: 400 });
    }
    if (mediaType !== 'attachment' && (!url || !String(url).trim())) {
      return NextResponse.json({ success: false, error: 'Link is verplicht' }, { status: 400 });
    }
    if (!section || typeof section !== 'string' || !section.trim()) {
      return NextResponse.json({ success: false, error: 'Sectie is verplicht' }, { status: 400 });
    }

    const draft = addMediaToDraft(serviceDate, {
      mediaType,
      url: url ? String(url).trim() : undefined,
      attachmentName,
      filePath,
      section: section.trim()
    });
    return NextResponse.json({ success: true, draft });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
