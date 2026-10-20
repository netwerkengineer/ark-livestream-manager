import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized } from '@/lib/authHelper';
import { SFEREN } from '@/lib/sfeer';
export const dynamic = 'force-dynamic';

// Lijst met sferen voor de keuzelijst in de setlist-bouwer.
export async function GET(req: NextRequest) {
  const session = await isAuthorized(req, undefined, 'freeshow');
  if (!session) return NextResponse.json({ error: 'Niet geautoriseerd' }, { status: 401 });
  return NextResponse.json({ sferen: SFEREN.map(s => ({ slug: s.slug, naam: s.naam, kleur: `#${s.main}`, accent: `#${s.accent}` })) });
}
