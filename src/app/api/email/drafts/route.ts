import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized } from '@/lib/authHelper';
import { getDraftServices, getUnassignedEmails, deleteDraftService } from '@/lib/draftServicesStore';

// Read-only listing of accumulated draft services + emails that couldn't be
// matched to a service date, for the drafts review tab.
export async function GET(req: NextRequest) {
  const authSession = await isAuthorized(req, undefined, 'freeshow');
  if (!authSession) {
    return NextResponse.json({ error: 'Niet geautoriseerd' }, { status: 401 });
  }

  try {
    const drafts = getDraftServices();
    const unassigned = getUnassignedEmails();
    return NextResponse.json({ success: true, drafts, unassigned });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// Removes a draft service record (e.g. after the service has passed) -
// doesn't touch any .project file already generated from it on the NAS.
export async function DELETE(req: NextRequest) {
  const authSession = await isAuthorized(req, undefined, 'freeshow');
  if (!authSession) {
    return NextResponse.json({ error: 'Niet geautoriseerd' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const serviceDate = searchParams.get('serviceDate');
  if (!serviceDate) {
    return NextResponse.json({ success: false, error: 'Geen serviceDate opgegeven' }, { status: 400 });
  }

  try {
    const deleted = deleteDraftService(serviceDate);
    if (!deleted) {
      return NextResponse.json({ success: false, error: 'Concept-dienst niet gevonden' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
