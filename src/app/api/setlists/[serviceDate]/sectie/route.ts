import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized } from '@/lib/authHelper';
import { setSectionAfterInDraft } from '@/lib/draftServicesStore';

// Legt vast na welke sectie een zelf aangemaakte sectie (bijv. "Avondmaal") in het project komt.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ serviceDate: string }> }) {
  const authSession = await isAuthorized(req, undefined, 'freeshow');
  if (!authSession) {
    return NextResponse.json({ error: 'Niet geautoriseerd' }, { status: 401 });
  }
  const { serviceDate } = await params;
  try {
    const { section, after } = await req.json();
    if (!section || typeof section !== 'string' || !section.trim() || !after || typeof after !== 'string') {
      return NextResponse.json({ success: false, error: 'Sectie en plek zijn verplicht' }, { status: 400 });
    }
    const draft = setSectionAfterInDraft(serviceDate, section.trim(), after.trim());
    return NextResponse.json({ success: true, draft });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
