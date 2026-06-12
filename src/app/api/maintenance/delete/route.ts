import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { isAuthorized } from '@/lib/authHelper';
import { getSettings } from '@/lib/settingsStore';

export async function POST(req: NextRequest) {
  try {
    const authSession = await isAuthorized(req, undefined, "freeshow");
    if (!authSession) {
      return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
    }

    const { filename } = await req.json();
    const settings = getSettings() as any;
    const freeshowPath = settings.freeshowPath || '';
    const freeshowTrashPath = settings.freeshowTrashPath || '';

    if (!filename) return NextResponse.json({ success: false, error: 'Invalid request.' }, { status: 400 });

    const showPath = path.join(freeshowPath, 'Shows', filename);
    
    // Use custom trash path or default on NAS
    const backupDir = freeshowTrashPath || path.join(freeshowPath, '.trash');
    const backupPath = path.join(backupDir, `${Date.now()}_${filename}`);

    // 1. Zorg dat de backup-map bestaat
    await fs.mkdir(backupDir, { recursive: true });

    // 2. Kopieer het bestand naar de kluis (als vangnet)
    const content = await fs.readFile(showPath);
    await fs.writeFile(backupPath, content);

    // 3. Verwijder het originele bestand op de NAS
    await fs.unlink(showPath);

    return NextResponse.json({ success: true, message: 'File safely deleted and archived.' });

  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
