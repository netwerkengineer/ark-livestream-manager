import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized } from '@/lib/authHelper';
import { setBijbelStijlInDraft } from '@/lib/draftServicesStore';
import { isBijbelStijl } from '@/lib/bijbelstijlen';

// Zet de opmaak/achtergrond van de bijbelteksten voor deze dienst (zie src/lib/bijbelstijlen.ts).
export async function PUT(req: NextRequest, { params }: { params: Promise<{ serviceDate: string }> }) {
  const authSession = await isAuthorized(req, undefined, 'freeshow');
  if (!authSession) {
    return NextResponse.json({ error: 'Niet geautoriseerd' }, { status: 401 });
  }
  const { serviceDate } = await params;
  try {
    const { stijl } = await req.json();
    if (!isBijbelStijl(stijl)) {
      return NextResponse.json({ success: false, error: 'Onbekende bijbelstijl' }, { status: 400 });
    }
    const draft = setBijbelStijlInDraft(serviceDate, stijl);
    if (!draft) return NextResponse.json({ success: false, error: 'Dienst niet gevonden' }, { status: 404 });
    return NextResponse.json({ success: true, draft });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
