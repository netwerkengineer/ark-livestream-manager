import { NextRequest, NextResponse } from 'next/server';
import { checkEmailsForProjects } from '@/lib/email';
import { isAuthorized } from '@/lib/authHelper';

// Manually triggers an IMAP check ("Check nu" in the drafts review tab).
// Background polling (phase 4) calls checkEmailsForProjects() the same way.
export async function GET(req: NextRequest) {
  try {
    const authSession = await isAuthorized(req, undefined, 'freeshow');
    if (!authSession) {
      return NextResponse.json({ error: 'Niet geautoriseerd' }, { status: 401 });
    }

    const updatedDrafts = await checkEmailsForProjects();
    return NextResponse.json({ success: true, updatedDrafts });
  } catch (error: any) {
    console.error('Email Fetch Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
