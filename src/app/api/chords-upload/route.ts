import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { isAuthorized } from '@/lib/authHelper';

// Deliberately its own fixed directory under this app's own data folder,
// not settings.freeshowMediaPath - a chord chart is a document for this
// app's own use (attaching to a setlist e-mail), not FreeShow media, and
// this route (unlike /api/upload) never trusts a client-supplied directory.
const CHORDS_DIR = join(process.cwd(), 'data', 'chordCharts');
const ALLOWED_EXTENSIONS = ['.txt', '.pdf'];

export async function POST(req: NextRequest) {
  const authSession = await isAuthorized(req, undefined, 'freeshow');
  if (!authSession) {
    return NextResponse.json({ error: 'Niet geautoriseerd' }, { status: 401 });
  }

  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    if (!file) {
      return NextResponse.json({ success: false, error: 'Geen bestand ontvangen' }, { status: 400 });
    }

    const dotIdx = file.name.lastIndexOf('.');
    const ext = dotIdx !== -1 ? file.name.slice(dotIdx).toLowerCase() : '';
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return NextResponse.json({ success: false, error: 'Alleen .txt of .pdf toegestaan' }, { status: 400 });
    }

    await mkdir(CHORDS_DIR, { recursive: true });
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    // Timestamp-prefixed to avoid collisions between different songs'
    // same-named chart files (e.g. two bands both uploading "akkoorden.pdf").
    const safeName = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_')}`;
    const filePath = join(CHORDS_DIR, safeName);
    await writeFile(filePath, buffer);

    return NextResponse.json({ success: true, filePath, fileName: file.name });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
