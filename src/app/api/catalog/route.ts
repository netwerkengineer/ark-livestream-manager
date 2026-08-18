import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { isAuthorized } from '@/lib/authHelper';
import { getSettings } from '@/lib/settingsStore';
import { mapWithConcurrency } from '@/lib/concurrency';

interface CachedSong {
  name: string;
  category: string;
  mtimeMs: number;
  size: number;
}

let songCache: Record<string, CachedSong> = {};
let cacheLoaded = false;

const CACHE_FILE = path.join(process.cwd(), 'data', 'catalog_songs_cache.json');

async function loadCache() {
  if (cacheLoaded) return;
  try {
    const content = await fs.readFile(CACHE_FILE, 'utf-8');
    songCache = JSON.parse(content);
  } catch (e) {
    // No cache yet, or unreadable - start fresh
  }
  cacheLoaded = true;
}

async function saveCache() {
  try {
    await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });
    await fs.writeFile(CACHE_FILE, JSON.stringify(songCache), 'utf-8');
  } catch (e) {
    console.error("Failed to save catalog songs cache:", e);
  }
}

export async function GET(req: NextRequest) {
  try {
    const authSession = await isAuthorized(req, undefined, "freeshow");
    if (!authSession) {
      return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
    }

    const settings = getSettings() as any;
    const freeshowPath = settings.freeshowPath || '';

    let categories: Record<string, any> = {
      song: { name: "category.song", icon: "song", default: true },
      presentation: { name: "category.presentation", icon: "presentation", default: true },
      scripture: { name: "category.scripture", icon: "scripture", default: true }
    };

    if (freeshowPath) {
      try {
        const settingsSyncedPath = path.join(freeshowPath, 'Config', 'settings_synced.json');
        const exists = await fs.access(settingsSyncedPath).then(() => true).catch(() => false);
        if (exists) {
          const content = await fs.readFile(settingsSyncedPath, 'utf-8');
          const config = JSON.parse(content);
          if (config.categories) {
            categories = { ...categories, ...config.categories };
          }
        }
      } catch (err) {
        console.error("Failed to read settings_synced.json categories:", err);
      }
    }

    const catalog: { songs: { name: string, category: string }[], bibles: string[] } = {
      songs: [],
      bibles: []
    };

    if (freeshowPath) {
      // 1. Scan Songs and their categories
      try {
        await loadCache();
        const showsDir = path.join(freeshowPath, 'Shows');
        const songFiles = (await fs.readdir(showsDir)).filter(f => f.toLowerCase().endsWith('.show'));

        let cacheChanged = false;
        catalog.songs = await mapWithConcurrency(songFiles, 16, async (file) => {
          const filePath = path.join(showsDir, file);
          try {
            const stats = await fs.stat(filePath);
            const cached = songCache[file];
            if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
              return { name: cached.name, category: cached.category };
            }

            // Read first 2KB to find the category quickly
            const handle = await fs.open(filePath, 'r');
            const { buffer } = await handle.read(Buffer.alloc(2048), 0, 2048, 0);
            await handle.close();

            const content = buffer.toString('utf-8');
            const categoryMatch = content.match(/"category"\s*:\s*"([^"]+)"/);
            const category = categoryMatch ? categoryMatch[1] : 'unknown';
            const name = file.replace(/\.show$/i, '');

            songCache[file] = { name, category, mtimeMs: stats.mtimeMs, size: stats.size };
            cacheChanged = true;
            return { name, category };
          } catch (fileErr) {
            // Fallback if file cannot be read
            return { name: file.replace(/\.show$/i, ''), category: 'unknown' };
          }
        });

        // Clean up cache entries for deleted files
        const fileSet = new Set(songFiles);
        for (const cachedFile of Object.keys(songCache)) {
          if (!fileSet.has(cachedFile)) {
            delete songCache[cachedFile];
            cacheChanged = true;
          }
        }

        if (cacheChanged) {
          await saveCache();
        }
      } catch (err) {
        // Silently ignore if folder missing
      }

      // 2. Scan Bibles
      try {
        const biblesDir = path.join(freeshowPath, 'Bibles');
        const bibleFiles = await fs.readdir(biblesDir);
        // "Dutch (BB) 2016 BasisBijbel.fsb" - return the whole string minus
        // the extension so the user gets clear information in the UI.
        catalog.bibles = bibleFiles
          .filter(f => f.toLowerCase().endsWith('.fsb'))
          .map(f => f.replace(/\.fsb$/i, ''));
      } catch (err) {}
    }

    return NextResponse.json({ success: true, catalog, categories });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
