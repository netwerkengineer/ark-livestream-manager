import fs from 'fs/promises';
import path from 'path';

export interface CachedShow {
  name: string;
  filename: string;
  category: string;
  slideCount: number;
  lastModified: string;
  size: number;
  mtimeMs: number;
  contentHash: string;
  mediaInfo: { name: string; type: string } | null;
}

let memoryCache: Record<string, CachedShow> = {};
let cacheLoaded = false;

const CACHE_FILE = path.join(process.cwd(), 'data', 'shows_metadata_cache.json');

export async function loadCache(): Promise<Record<string, CachedShow>> {
  if (cacheLoaded) return memoryCache;
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
  return memoryCache;
}

export async function saveCache() {
  try {
    await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });
    await fs.writeFile(CACHE_FILE, JSON.stringify(memoryCache, null, 2), 'utf-8');
  } catch (e) {
    console.error("Failed to save show metadata cache:", e);
  }
}

export function getMemoryCache() {
  return memoryCache;
}

export function setMemoryCacheEntry(filename: string, show: CachedShow) {
  memoryCache[filename] = show;
}

export function deleteMemoryCacheEntry(filename: string) {
  delete memoryCache[filename];
}
