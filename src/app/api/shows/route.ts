import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { isAuthorized } from '@/lib/authHelper';
import { getSettings } from '@/lib/settingsStore';

export async function GET(req: NextRequest) {
  try {
    const authSession = await isAuthorized(req);
    if (!authSession) {
      return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
    }

    const settings = getSettings() as any;
    const freeshowPath = settings.freeshowPath || '';
    if (!freeshowPath) {
      return NextResponse.json({ success: false, error: 'FreeShow path not configured' }, { status: 400 });
    }

    const showsDir = path.join(freeshowPath, 'Shows');
    const files = await fs.readdir(showsDir);
    const shows = [];

    for (const file of files) {
      if (file.toLowerCase().endsWith('.show')) {
        const filePath = path.join(showsDir, file);
        try {
          const stats = await fs.stat(filePath);
          const fullContentData = await fs.readFile(filePath, 'utf-8');
          const showObj = JSON.parse(fullContentData);
          
          let category = 'unknown';
          let slideCount = 0;
          
          if (Array.isArray(showObj) && showObj[1]) {
            const details = showObj[1];
            category = details.category || 'unknown';
            slideCount = details.slides ? Object.keys(details.slides).length : 0;
          }

          shows.push({
            name: file.replace(/\.show$/i, ''),
            filename: file,
            category,
            slideCount,
            lastModified: stats.mtime.toISOString(),
            size: stats.size
          });
        } catch (fileErr) {
          shows.push({
            name: file.replace(/\.show$/i, ''),
            filename: file,
            category: 'unknown',
            slideCount: 0,
            lastModified: new Date().toISOString(),
            size: 0
          });
        }
      }
    }

    return NextResponse.json({ success: true, shows });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
