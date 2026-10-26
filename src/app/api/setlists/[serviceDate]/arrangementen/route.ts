import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized } from '@/lib/authHelper';
import { createOrGetDraftService } from '@/lib/draftServicesStore';
import { getLocalShowData } from '@/lib/songs';

// Per lied op de setlist de arrangementen (layouts) die de show van dat lied in de catalogus heeft, voor de keuzelijst in de setlist.
// Liederen met één arrangement (of die nog niet in de catalogus staan) komen er niet in voor: daar valt niets te kiezen.
export async function GET(req: NextRequest, { params }: { params: Promise<{ serviceDate: string }> }) {
  const authSession = await isAuthorized(req, undefined, 'freeshow');
  if (!authSession) {
    return NextResponse.json({ error: 'Niet geautoriseerd' }, { status: 401 });
  }

  const { serviceDate } = await params;
  try {
    const draft = createOrGetDraftService(serviceDate);
    const arrangementen: Record<string, { actief: string; opties: { id: string; naam: string }[] }> = {};
    for (const song of draft.songs) {
      const show = await getLocalShowData(song.title, song.artist || '');
      const layouts = show?.data?.layouts as Record<string, { name?: string }> | undefined;
      if (!layouts || Object.keys(layouts).length < 2) continue;
      arrangementen[song.id] = {
        actief: show?.data?.settings?.activeLayout || Object.keys(layouts)[0],
        opties: Object.entries(layouts).map(([id, l]) => ({ id, naam: l?.name || id })),
      };
    }
    return NextResponse.json({ success: true, arrangementen });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
