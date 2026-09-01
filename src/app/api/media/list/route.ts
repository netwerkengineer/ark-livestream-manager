import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { isAuthorized } from '@/lib/authHelper';
import { getSettings } from '@/lib/settingsStore';

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mov']);

interface MediaEntry {
  name: string;
  relativePath: string;
  // Absolute path as seen by this server (the NAS) - this is exactly what
  // the existing /api/upload endpoint hands back as data.filePath when a
  // *new* background is uploaded, and createShowObject writes that same
  // value straight into a show's media.path. Reusing it here means a show
  // background set from the existing library resolves in FreeShow exactly
  // like one attached via a fresh upload already does.
  absolutePath: string;
  type: 'image' | 'video';
}

// Media, unlike Shows, is organized in subfolders (e.g. one per
// presentation/slideshow), so this walks recursively instead of a flat
// readdir. The library is small enough here (order of 100s of files) that
// there's no need for the mtime-based cache the Shows listing uses.
async function walk(dir: string, baseDir: string, results: MediaEntry[]) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath, baseDir, results);
    } else {
      const ext = path.extname(entry.name).toLowerCase();
      const type = IMAGE_EXTENSIONS.has(ext) ? 'image' : VIDEO_EXTENSIONS.has(ext) ? 'video' : null;
      if (!type) continue;
      results.push({
        name: entry.name,
        relativePath: path.relative(baseDir, fullPath).split(path.sep).join('/'),
        absolutePath: fullPath,
        type
      });
    }
  }
}

export async function GET(req: NextRequest) {
  try {
    const authSession = await isAuthorized(req);
    if (!authSession) {
      return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
    }

    const settings = getSettings() as any;
    const mediaPath = settings.freeshowMediaPath || '';
    if (!mediaPath) {
      return NextResponse.json({ success: false, error: 'FreeShow media path not configured' }, { status: 400 });
    }

    try {
      await fs.access(mediaPath);
    } catch (e) {
      return NextResponse.json({ success: false, error: 'Media directory not found' }, { status: 404 });
    }

    const results: MediaEntry[] = [];
    await walk(mediaPath, mediaPath, results);
    results.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

    return NextResponse.json({ success: true, media: results });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
