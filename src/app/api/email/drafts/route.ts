import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized } from '@/lib/authHelper';
import { getDraftServices, getUnassignedEmails } from '@/lib/draftServicesStore';

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
