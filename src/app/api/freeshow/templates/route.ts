import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized } from '@/lib/authHelper';
import { getSettings } from '@/lib/settingsStore';
import { listTemplates } from '@/lib/freeshowStyles';

// Namen van de FreeShow-sjablonen voor liedteksten (keuzelijst bij Instellingen -> FreeShow).
export async function GET(req: NextRequest) {
  const authSession = await isAuthorized(req, undefined, 'freeshow');
  if (!authSession) {
    return NextResponse.json({ error: 'Niet geautoriseerd' }, { status: 401 });
  }
  const settings = getSettings() as any;
  const all = await listTemplates(settings.freeshowPath);
  const names = Array.from(new Set(all.filter(t => t.category !== 'scripture').map(t => t.name))).sort((a, b) => a.localeCompare(b));
  return NextResponse.json({ templates: names });
}
