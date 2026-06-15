import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { isAuthorized } from '@/lib/authHelper';
import { getSettings } from '@/lib/settingsStore';

interface CachedShow {
  name: string;
  filename: string;
  category: string;
  slideCount: number;
  lastModified: string;
  size: number;
  mtimeMs: number;
}

let memoryCache: Record<string, CachedShow> = {};
let cacheLoaded = false;

const CACHE_FILE = path.join(process.cwd(), 'data', 'shows_metadata_cache.json');

async function loadCache() {
  if (cacheLoaded) return;
  try {
    const exists = await fs.access(CACHE_FILE).then(() => true).catch(() => false);
    if (exists) {
      const content = await fs.readFile(CACHE_FILE, 'utf-8');
      memoryCache = JSON.parse(content);
    }
  } catch (e) {
    console.error("Failed to load show metadata cache:", e);
  }
  cacheLoaded = true;
}

async function saveCache() {
  try {
    await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });
    await fs.writeFile(CACHE_FILE, JSON.stringify(memoryCache, null, 2), 'utf-8');
  } catch (e) {
    console.error("Failed to save show metadata cache:", e);
  }
}

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

    const showsDir = path.join(freeshowPath, 'Shows');
    
    try {
      await fs.access(showsDir);
    } catch (e) {
      return NextResponse.json({ success: false, error: 'Shows directory not found' }, { status: 404 });
    }

    const files = await fs.readdir(showsDir);
    await loadCache();
    
    const shows: CachedShow[] = [];
    let cacheUpdated = false;
    let processedCount = 0;

    for (const file of files) {
      if (file.toLowerCase().endsWith('.show')) {
        const filePath = path.join(showsDir, file);
        try {
          const stats = await fs.stat(filePath);
          const cached = memoryCache[file];
          
          if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
            shows.push(cached);
          } else {
            const fullContentData = await fs.readFile(filePath, 'utf-8');
            const showObj = JSON.parse(fullContentData);
            
            let category = 'song';
            let slideCount = 0;
            let name = file.replace(/\.show$/i, '');
            
            const showData = Array.isArray(showObj) && showObj[1] ? showObj[1] : showObj;
            if (showData) {
              category = showData.category || 'song';
              slideCount = showData.slides ? Object.keys(showData.slides).length : 0;
              if (showData.name) {
                name = showData.name;
              }
            }

            const newShow: CachedShow = {
              name,
              filename: file,
              category,
              slideCount,
              lastModified: stats.mtime.toISOString(),
              size: stats.size,
              mtimeMs: stats.mtimeMs
            };

            memoryCache[file] = newShow;
            shows.push(newShow);
            cacheUpdated = true;
          }
        } catch (fileErr) {
          shows.push({
            name: file.replace(/\.show$/i, ''),
            filename: file,
            category: 'unknown',
            slideCount: 0,
            lastModified: new Date().toISOString(),
            size: 0,
            mtimeMs: 0
          });
        }

        processedCount++;
        if (processedCount % 100 === 0) {
          // Yield control back to the event loop so other network requests can be handled
          await new Promise<void>(resolve => setImmediate(resolve));
        }
      }
    }

    // Clean up cache of deleted files
    const fileSet = new Set(files);
    let deletedFromCache = false;
    for (const cachedFile of Object.keys(memoryCache)) {
      if (!fileSet.has(cachedFile)) {
        delete memoryCache[cachedFile];
        deletedFromCache = true;
      }
    }

    if (cacheUpdated || deletedFromCache) {
      await saveCache();
    }

    return NextResponse.json({ success: true, shows, categories });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
