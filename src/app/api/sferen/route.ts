import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized } from '@/lib/authHelper';
import { SFEREN, EIGEN_PREFIX } from '@/lib/sfeer';
import { ownLights } from '@/lib/lightsTrigger';
export const dynamic = 'force-dynamic';

// Lijst met sferen voor de keuzelijst in de setlist-bouwer, met daarachter de eigen scènes en chases uit de lichtregie (alleen licht, geen filmpje).
export async function GET(req: NextRequest) {
  const session = await isAuthorized(req, undefined, 'freeshow');
  if (!session) return NextResponse.json({ error: 'Niet geautoriseerd' }, { status: 401 });
  const sferen = SFEREN.map(s => ({ slug: s.slug, naam: s.naam, kleur: `#${s.main}`, accent: `#${s.accent}`, wit: s.wit, groep: 'Sferen (achtergrond en licht)' }));
  let eigen: typeof sferen = [];
  try {
    eigen = ownLights().map(f => ({ slug: EIGEN_PREFIX + f.id, naam: f.name, kleur: f.type === 'Chaser' ? '#a78bfa' : '#94a3b8', accent: f.type === 'Chaser' ? '#38bdf8' : '#94a3b8', wit: 0, groep: 'Eigen licht (alleen licht)' }));
  } catch { /* geen werkbestand: dan alleen de sferen */ }
  return NextResponse.json({ sferen: [...sferen, ...eigen] });
}
