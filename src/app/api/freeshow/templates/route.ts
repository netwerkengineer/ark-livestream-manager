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
  // Alleen sjablonen voor liedteksten: de categorie "song" van FreeShow. Eigen categorieen (met een willekeurig id) tellen mee als
  // de naam op een liedsjabloon wijst ("lyrics", "song", "lied"); bijbel- en presentatiesjablonen vallen af.
  const isLied = (t: { name: string; category: string; mode: string }) => {
    if (t.mode === 'scripture' || t.category === 'scripture' || t.category === 'presentation') return false;
    if (t.category === 'song') return true;
    return /lyric|song|lied/i.test(t.name) && !/scrip|bijbel/i.test(t.name);
  };
  const names = Array.from(new Set(all.filter(isLied).map(t => t.name))).sort((a, b) => a.localeCompare(b));
  return NextResponse.json({ templates: names });
}
