import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { isAuthorized } from '@/lib/authHelper';
import { getSettings } from '@/lib/settingsStore';

// Notitie bij een dia van een FreeShow-show toevoegen, aanpassen of wissen (leeg = wissen). Een notitie hoort bij de dia zelf,
// dus ze staat in elk arrangement (Default, Tracks, eigen arrangementen) waarin die dia voorkomt.
//
// POST { slideId, notes }

const MAX_NOTE_LENGTH = 4000;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authSession = await isAuthorized(request, undefined, 'freeshow');
    if (!authSession) {
      return NextResponse.json({ error: 'Niet geautoriseerd' }, { status: 401 });
    }

    const settings = getSettings() as any;
    const freeshowPath = settings.freeshowPath || '';
    if (!freeshowPath) {
      return NextResponse.json({ success: false, error: 'FreeShow path not configured' }, { status: 400 });
    }

    const { id } = await params;
    const decodedId = decodeURIComponent(id);
    const filename = decodedId.toLowerCase().endsWith('.show') ? decodedId : `${decodedId}.show`;
    if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
      return NextResponse.json({ success: false, error: 'Ongeldige bestandsnaam' }, { status: 400 });
    }
    const filePath = path.join(freeshowPath, 'Shows', filename);

    const body = await request.json();
    const slideId = String(body.slideId || '');
    const notes = String(body.notes ?? '').replace(/\r\n/g, '\n');
    if (notes.length > MAX_NOTE_LENGTH) {
      return NextResponse.json({ success: false, error: `Een notitie mag maximaal ${MAX_NOTE_LENGTH} tekens zijn` }, { status: 400 });
    }

    let showData: any;
    try {
      showData = JSON.parse(await fs.readFile(filePath, 'utf-8'));
    } catch (err: any) {
      return NextResponse.json({ success: false, error: `Show niet gevonden: ${err.message}` }, { status: 404 });
    }
    const show = showData[1];
    if (!slideId || !show.slides?.[slideId]) {
      return NextResponse.json({ success: false, error: 'Dia niet gevonden' }, { status: 404 });
    }

    show.slides[slideId].notes = notes.trim() ? notes : '';
    show.timestamps = { ...(show.timestamps || {}), modified: Date.now() };
    await fs.writeFile(filePath, JSON.stringify([showData[0], show], null, 2), 'utf-8');
    return NextResponse.json({ success: true, show: [showData[0], show] });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
