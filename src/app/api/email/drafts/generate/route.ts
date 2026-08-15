import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized } from '@/lib/authHelper';
import { getDraftService } from '@/lib/draftServicesStore';
import { generateProjectForDraft } from '@/lib/draftProjectGenerator';

// Manually (re)generates the FreeShow project for one draft service - used
// both for the initial "Project aanmaken" action and "Project bijwerken"
// after a correction, and for the explicit "Toch overschrijven" retry when
// generateProjectForDraft reports a conflict.
export async function POST(req: NextRequest) {
  const authSession = await isAuthorized(req, undefined, 'freeshow');
  if (!authSession) {
    return NextResponse.json({ error: 'Niet geautoriseerd' }, { status: 401 });
  }

  try {
    const { serviceDate, force } = await req.json();
    if (!serviceDate) {
      return NextResponse.json({ success: false, error: 'serviceDate ontbreekt' }, { status: 400 });
    }

    const draft = getDraftService(serviceDate);
    if (!draft) {
      return NextResponse.json({ success: false, error: 'Concept-dienst niet gevonden' }, { status: 404 });
    }

    const result = await generateProjectForDraft(draft, { force: !!force });
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[Project Generator] Fout:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
