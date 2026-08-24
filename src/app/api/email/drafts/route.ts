import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized } from '@/lib/authHelper';
import { getDraftServices, getUnassignedEmails, deleteDraftService, deleteUnassignedEmail, removeItemFromDraft } from '@/lib/draftServicesStore';

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
  const messageId = searchParams.get('messageId');
  const itemType = searchParams.get('itemType') as 'song' | 'scripture' | 'media' | null;
  const itemId = searchParams.get('itemId');
  if (!serviceDate && !messageId) {
    return NextResponse.json({ success: false, error: 'Geen serviceDate of messageId opgegeven' }, { status: 400 });
  }

  try {
    // serviceDate + itemType + itemId together = remove just that one item
    // (the 🗑️ next to a single song/tekst/media row); serviceDate alone =
    // remove the whole draft service.
    const deleted = serviceDate && itemType && itemId
      ? removeItemFromDraft(serviceDate, itemType, itemId)
      : serviceDate
        ? deleteDraftService(serviceDate)
        : deleteUnassignedEmail(messageId!);
    if (!deleted) {
      const notFoundMsg = itemType ? 'Item niet gevonden' : serviceDate ? 'Concept-dienst niet gevonden' : 'Mail niet gevonden';
      return NextResponse.json({ success: false, error: notFoundMsg }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
