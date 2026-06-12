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

    const catalog: { songs: { name: string, category: string }[], bibles: string[] } = {
      songs: [],
      bibles: []
    };

    if (freeshowPath) {
      // 1. Scan Songs and their categories
      try {
        const showsDir = path.join(freeshowPath, 'Shows');
        const songFiles = await fs.readdir(showsDir);
        for (const file of songFiles) {
          if (file.toLowerCase().endsWith('.show')) {
            try {
              const filePath = path.join(showsDir, file);
              // Read first 2KB to find the category quickly
              const handle = await fs.open(filePath, 'r');
              const { buffer } = await handle.read(Buffer.alloc(2048), 0, 2048, 0);
              await handle.close();
              
              const content = buffer.toString('utf-8');
              const categoryMatch = content.match(/"category"\s*:\s*"([^"]+)"/);
              const category = categoryMatch ? categoryMatch[1] : 'unknown';
              
              catalog.songs.push({
                name: file.replace(/\.show$/i, ''),
                category: category
              });
            } catch (fileErr) {
              // Fallback if file cannot be read
              catalog.songs.push({
                name: file.replace(/\.show$/i, ''),
                category: 'unknown'
              });
            }
          }
        }
      } catch (err) {
        // Silently ignore if folder missing
      }

      // 2. Scan Bibles
      try {
        const biblesDir = path.join(freeshowPath, 'Bibles');
        const bibleFiles = await fs.readdir(biblesDir);
        for (const file of bibleFiles) {
          if (file.toLowerCase().endsWith('.fsb')) {
            // "Dutch (BB) 2016 BasisBijbel.fsb"
            // We want to return the whole string to display, or just extract the tag.
            // Returning the file name (without .fsb) gives the user clear information.
            const rawName = file.replace(/\.fsb$/i, '');
            catalog.bibles.push(rawName);
          }
        }
      } catch(err) {}
    }

    return NextResponse.json({ success: true, catalog });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
