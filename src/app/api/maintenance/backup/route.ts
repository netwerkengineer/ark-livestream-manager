import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import JSZip from 'jszip';
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

    if (!freeshowPath) {
      return NextResponse.json({ success: false, error: 'FreeShow path not set.' }, { status: 400 });
    }

    const zip = new JSZip();
    const backupDate = new Date().toISOString().replace(/[:.]/g, '-');
    
    // 1. Pack Shows
    try {
      const showsDir = path.join(freeshowPath, 'Shows');
      const files = await fs.readdir(showsDir);
      const showsFolder = zip.folder("Shows");
      for (const file of files) {
        if (file.toLowerCase().endsWith('.show')) {
          const content = await fs.readFile(path.join(showsDir, file));
          showsFolder?.file(file, content);
        }
      }
    } catch (e) {}

    // 2. Pack Bibles
    try {
      const biblesDir = path.join(freeshowPath, 'Bibles');
      const files = await fs.readdir(biblesDir);
      const biblesFolder = zip.folder("Bibles");
      for (const file of files) {
        if (file.toLowerCase().endsWith('.fsb')) {
          const content = await fs.readFile(path.join(biblesDir, file));
          biblesFolder?.file(file, content);
        }
      }
    } catch (e) {}

    const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });

    // 3. Save a local copy for safety
    const localBackupDir = path.join(process.cwd(), 'data', 'backups');
    await fs.mkdir(localBackupDir, { recursive: true });
    await fs.writeFile(path.join(localBackupDir, `freeshow_backup_${backupDate}.zip`), zipBuffer);

    // 4. Return as download
    return new NextResponse(zipBuffer as any, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename=freeshow_backup_${backupDate}.zip`
      }
    });

  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
