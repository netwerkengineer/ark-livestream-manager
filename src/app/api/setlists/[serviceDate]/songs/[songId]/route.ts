import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized } from '@/lib/authHelper';
import { updateSongInDraft, removeItemFromDraft } from '@/lib/draftServicesStore';

// Edits one song already on the setlist (title/section/lyrics/chords) -
// there was previously no update path in draftServicesStore, only add/remove.
// Deliberately POST, not PATCH: the reverse proxy in front of the Proxmox
// test environment (nginx, via Nginx Proxy Manager) returns a bare 405 for
// PATCH before the request ever reaches this app - confirmed live, GET/
// POST/DELETE all pass through fine. Production sits behind a different
// proxy (Synology's own), so rather than depend on either proxy's method
// allowlist this just avoids PATCH entirely.
export async function POST(req: NextRequest, { params }: { params: Promise<{ serviceDate: string; songId: string }> }) {
  const authSession = await isAuthorized(req, undefined, 'freeshow');
  if (!authSession) {
    return NextResponse.json({ error: 'Niet geautoriseerd' }, { status: 401 });
  }

  const { serviceDate, songId } = await params;
  try {
    const patch = await req.json();
    const draft = updateSongInDraft(serviceDate, songId, patch);
    if (!draft) {
      return NextResponse.json({ success: false, error: 'Lied of dienst niet gevonden' }, { status: 404 });
    }
    return NextResponse.json({ success: true, draft });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// Removes one song - reuses the same removeItemFromDraft the "Concepten"
// review tab's 🗑️ button already calls.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ serviceDate: string; songId: string }> }) {
  const authSession = await isAuthorized(req, undefined, 'freeshow');
  if (!authSession) {
    return NextResponse.json({ error: 'Niet geautoriseerd' }, { status: 401 });
  }

  const { serviceDate, songId } = await params;
  try {
    const removed = removeItemFromDraft(serviceDate, 'song', songId);
    if (!removed) {
      return NextResponse.json({ success: false, error: 'Lied niet gevonden' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
