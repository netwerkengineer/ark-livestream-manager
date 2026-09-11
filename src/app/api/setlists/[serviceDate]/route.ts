import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized } from '@/lib/authHelper';
import { createOrGetDraftService } from '@/lib/draftServicesStore';

// Fetches (creating on first load, so the builder UI always has a record to
// render/edit) the draft service for one date - the same DraftService the
// email pipeline populates, so a worship leader building a setlist by hand
// and a liturgie mail landing for the same Sunday merge into one record.
export async function GET(req: NextRequest, { params }: { params: Promise<{ serviceDate: string }> }) {
  const authSession = await isAuthorized(req, undefined, 'freeshow');
  if (!authSession) {
    return NextResponse.json({ error: 'Niet geautoriseerd' }, { status: 401 });
  }

  const { serviceDate } = await params;
  try {
    const draft = createOrGetDraftService(serviceDate);
    return NextResponse.json({ success: true, draft });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
