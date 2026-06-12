import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { isAuthorized } from '@/lib/authHelper';
import { getSettings } from '@/lib/settingsStore';

export async function GET(req: NextRequest) {
  try {
    const authSession = await isAuthorized(req, undefined, "freeshow");
    if (!authSession) {
      return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
    }

    const settings = getSettings() as any;
    const freeshowPath = settings.freeshowPath || '';
    const freeshowTrashPath = settings.freeshowTrashPath || '';

    const backupDir = freeshowTrashPath || (freeshowPath ? path.join(freeshowPath, '.trash') : path.join(process.cwd(), 'data', 'deleted_history'));

    await fs.mkdir(backupDir, { recursive: true });
    const files = await fs.readdir(backupDir);
    
    const history = files
      .filter(f => f.includes('_'))
      .map(f => {
        const parts = f.split('_');
        const timestamp = parseInt(parts[0]);
        const originalName = parts.slice(1).join('_');
        
        return {
          id: f,
          name: originalName,
          deletedAt: new Date(timestamp).toISOString()
        };
      })
      .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt))
      .slice(0, 50); // Laatste 50 verwijderde items

    return NextResponse.json({ success: true, history });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const authSession = await isAuthorized(req, undefined, "freeshow");
    if (!authSession) {
      return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
    }

    const { id } = await req.json(); // id is de volledige bestandsnaam in history
    if (!id) return NextResponse.json({ success: false, error: 'No ID provided' }, { status: 400 });

    const settings = getSettings() as any;
    const freeshowPath = settings.freeshowPath || '';
    const freeshowTrashPath = settings.freeshowTrashPath || '';

    if (!freeshowPath) {
      return NextResponse.json({ success: false, error: 'FreeShow path not set.' }, { status: 400 });
    }

    const backupDir = freeshowTrashPath || path.join(freeshowPath, '.trash');
    const sourcePath = path.join(backupDir, id);
    const originalName = id.split('_').slice(1).join('_');
    const targetPath = path.join(freeshowPath, 'Shows', originalName);

    // 1. Controleer of bron bestaat
    try {
      await fs.access(sourcePath);
    } catch {
      return NextResponse.json({ success: false, error: 'File not found in history.' }, { status: 404 });
    }

    // 2. Controleer of doel al bestaat (voorkom overschrijven)
    try {
      await fs.access(targetPath);
      return NextResponse.json({ success: false, error: 'A song with this name already exists in the library.' }, { status: 409 });
    } catch {}

    // 3. Herstel het bestand
    const content = await fs.readFile(sourcePath);
    await fs.writeFile(targetPath, content);

    // 4. Verwijder uit geschiedenis
    await fs.unlink(sourcePath);

    return NextResponse.json({ success: true, message: 'File successfully restored.' });

  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const authSession = await isAuthorized(req, undefined, "freeshow");
    if (!authSession) {
      return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
    }

    const settings = getSettings() as any;
    const freeshowPath = settings.freeshowPath || '';
    const freeshowTrashPath = settings.freeshowTrashPath || '';

    const backupDir = freeshowTrashPath || (freeshowPath ? path.join(freeshowPath, '.trash') : path.join(process.cwd(), 'data', 'deleted_history'));

    await fs.mkdir(backupDir, { recursive: true });
    const files = await fs.readdir(backupDir);
    
    let deletedCount = 0;
    for (const file of files) {
      if (file !== '.' && file !== '..') {
        const filePath = path.join(backupDir, file);
        const stats = await fs.stat(filePath);
        if (stats.isFile()) {
          await fs.unlink(filePath);
          deletedCount++;
        }
      }
    }

    return NextResponse.json({ success: true, message: `${deletedCount} bestanden succesvol definitief verwijderd.` });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
