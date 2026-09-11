import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized } from '@/lib/authHelper';
import { reorderSongsInDraft } from '@/lib/draftServicesStore';

// Reorders the songs on a setlist to match the order the worship leader
// arranged them in the builder UI.
export async function POST(req: NextRequest, { params }: { params: Promise<{ serviceDate: string }> }) {
  const authSession = await isAuthorized(req, undefined, 'freeshow');
  if (!authSession) {
    return NextResponse.json({ error: 'Niet geautoriseerd' }, { status: 401 });
  }

  const { serviceDate } = await params;
  try {
    const { orderedIds } = await req.json();
    if (!Array.isArray(orderedIds)) {
      return NextResponse.json({ success: false, error: 'orderedIds moet een array zijn' }, { status: 400 });
    }
    const draft = reorderSongsInDraft(serviceDate, orderedIds);
    if (!draft) {
      return NextResponse.json({ success: false, error: 'Dienst niet gevonden' }, { status: 404 });
    }
    return NextResponse.json({ success: true, draft });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
