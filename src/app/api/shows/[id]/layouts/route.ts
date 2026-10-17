import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { isAuthorized } from '@/lib/authHelper';
import { getSettings } from '@/lib/settingsStore';

// Arrangementen (layouts) van een FreeShow-show beheren vanuit de webapp: toevoegen, wijzigen (naam en volgorde van de dia's) en
// verwijderen. De indeling "Tracks" wordt door de Tracks-tab zelf gemaakt en bijgewerkt (Tekst koppelen, Timing opnemen); die
// blijft hier onaangeroerd, anders zou een volgende koppeling jouw wijziging overschrijven.
//
// POST { action: 'create' | 'update' | 'delete', layoutId?, name?, slides? }   slides = [{ id: <dia-id>, ...}] in de gewenste volgorde

const PROTECTED_LAYOUT_NAMES = ['Tracks'];

function newLayoutId(existing: Set<string>): string {
  for (;;) {
    const id = Math.random().toString(36).padEnd(15, '0').substring(2, 13);
    if (!existing.has(id)) return id;
  }
}

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
    const action = String(body.action || '');

    let showData: any;
    try {
      showData = JSON.parse(await fs.readFile(filePath, 'utf-8'));
    } catch (err: any) {
      return NextResponse.json({ success: false, error: `Show niet gevonden: ${err.message}` }, { status: 404 });
    }
    const showId = showData[0];
    const show = showData[1];
    show.layouts = show.layouts || {};
    show.slides = show.slides || {};

    const cleanName = (n: any) => String(n ?? '').replace(/[\\/:*?"<>|]/g, ' ').trim().slice(0, 60);
    const nameTaken = (name: string, exceptId?: string) =>
      Object.entries<any>(show.layouts).some(([lid, l]) => lid !== exceptId && String(l.name || '').toLowerCase() === name.toLowerCase());

    // dia's: alleen entries waarvan de dia echt in de show staat
    const checkedEntries = (raw: any): { entries?: any[]; error?: string } => {
      if (!Array.isArray(raw)) return { error: 'slides moet een lijst zijn' };
      const out: any[] = [];
      for (const e of raw) {
        const sid = e && typeof e === 'object' ? e.id : e;
        if (!sid || !show.slides[sid]) return { error: `Onbekende dia: ${String(sid)}` };
        out.push(typeof e === 'object' ? e : { id: sid });
      }
      return { entries: out };
    };

    if (action === 'create') {
      const name = cleanName(body.name);
      if (!name) return NextResponse.json({ success: false, error: 'Geef het arrangement een naam' }, { status: 400 });
      if (nameTaken(name)) return NextResponse.json({ success: false, error: `Er is al een arrangement "${name}"` }, { status: 409 });
      const checked = checkedEntries(body.slides ?? []);
      if (checked.error) return NextResponse.json({ success: false, error: checked.error }, { status: 400 });
      const layoutId = newLayoutId(new Set(Object.keys(show.layouts)));
      show.layouts[layoutId] = { name, notes: '', slides: checked.entries };
      show.timestamps = { ...(show.timestamps || {}), modified: Date.now() };
      await fs.writeFile(filePath, JSON.stringify([showId, show], null, 2), 'utf-8');
      return NextResponse.json({ success: true, layoutId, show: [showId, show] });
    }

    const layoutId = String(body.layoutId || '');
    const layout = show.layouts[layoutId];
    if (!layout) return NextResponse.json({ success: false, error: 'Arrangement niet gevonden' }, { status: 404 });
    if (PROTECTED_LAYOUT_NAMES.includes(String(layout.name))) {
      return NextResponse.json({ success: false, error: `Het arrangement "${layout.name}" wordt door de Tracks-tab beheerd en kan hier niet worden gewijzigd.` }, { status: 403 });
    }

    if (action === 'update') {
      if (body.name !== undefined) {
        const name = cleanName(body.name);
        if (!name) return NextResponse.json({ success: false, error: 'Geef het arrangement een naam' }, { status: 400 });
        if (nameTaken(name, layoutId)) return NextResponse.json({ success: false, error: `Er is al een arrangement "${name}"` }, { status: 409 });
        if (PROTECTED_LAYOUT_NAMES.includes(name)) return NextResponse.json({ success: false, error: `De naam "${name}" is gereserveerd voor de Tracks-tab` }, { status: 400 });
        layout.name = name;
      }
      if (body.slides !== undefined) {
        const checked = checkedEntries(body.slides);
        if (checked.error) return NextResponse.json({ success: false, error: checked.error }, { status: 400 });
        layout.slides = checked.entries;
      }
    } else if (action === 'delete') {
      if (Object.keys(show.layouts).length <= 1) {
        return NextResponse.json({ success: false, error: 'Een show moet minstens één arrangement houden' }, { status: 400 });
      }
      delete show.layouts[layoutId];
      if (show.settings?.activeLayout === layoutId) {
        const fallback = Object.entries<any>(show.layouts).find(([, l]) => l.name === 'Default')?.[0] || Object.keys(show.layouts)[0];
        show.settings = { ...(show.settings || {}), activeLayout: fallback };
      }
    } else {
      return NextResponse.json({ success: false, error: 'Onbekende actie' }, { status: 400 });
    }

    show.timestamps = { ...(show.timestamps || {}), modified: Date.now() };
    await fs.writeFile(filePath, JSON.stringify([showId, show], null, 2), 'utf-8');
    return NextResponse.json({ success: true, layoutId, show: [showId, show] });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
