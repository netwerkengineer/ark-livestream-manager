import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import * as levenshteinModule from 'levenshtein-edit-distance';
import { isAuthorized } from '@/lib/authHelper';
import { getSettings } from '@/lib/settingsStore';
import { loadCache, saveCache, setMemoryCacheEntry, CachedShow } from '@/lib/showsCache';
const levenshtein: any = (levenshteinModule as any).default || levenshteinModule;

interface ShowMeta {
  filename: string;
  name: string;
  category: string;
  modified: number;
  snippet: string;
  contentHash?: string;
  mediaInfo?: {
    name: string;
    type: string;
  } | null;
}

function getWords(s: string): Set<string> {
  const words = s.toLowerCase().match(/\w+/g) || [];
  return new Set(words);
}

function jaccardSimilarity(w1: Set<string>, w2: Set<string>): number {
  if (w1.size === 0 || w2.size === 0) return 0;
  
  let intersectionSize = 0;
  for (const w of w1) {
    if (w2.has(w)) {
      intersectionSize++;
    }
  }
  const unionSize = w1.size + w2.size - intersectionSize;
  return intersectionSize / unionSize;
}

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

    const showsDir = path.join(freeshowPath, 'Shows');
    const files = await fs.readdir(showsDir);
    const memoryCache = await loadCache();
    const showList: ShowMeta[] = [];

    let cacheUpdated = false;
    let processedCount = 0;

    for (const file of files) {
      if (file.toLowerCase().endsWith('.show')) {
        const filePath = path.join(showsDir, file);
        try {
          const stats = await fs.stat(filePath);
          const cached = memoryCache[file];
          
          let showData: CachedShow;
          // A cache entry written by an older schema (before contentHash was
          // added) matches on mtime/size but lacks it, which crashed every
          // single scan (contentHash.substring on undefined) - never
          // resulting in a duplicate group at all. Treat that as stale too.
          if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size && typeof cached.contentHash === 'string') {
            showData = cached;
          } else {
            const content = await fs.readFile(filePath, 'utf-8');
            const json = JSON.parse(content);
            
            const rawData = Array.isArray(json) && json.length === 2 ? json[1] : json;
            let mediaInfo = null;
            if (rawData.media && Object.keys(rawData.media).length > 0) {
              const firstMedia: any = Object.values(rawData.media)[0];
              mediaInfo = { name: firstMedia.name, type: firstMedia.type };
            }

            let allText = '';
            if (rawData.slides) {
              Object.values(rawData.slides).forEach((slide: any) => {
                if (slide.items) {
                  slide.items.forEach((item: any) => {
                    if (item.lines) {
                      item.lines.forEach((line: any) => {
                        if (line.text) {
                          line.text.forEach((t: any) => {
                            if (t.value) allText += t.value + ' ';
                          });
                        }
                      });
                    }
                  });
                }
              });
            }

            showData = {
              name: rawData.name || file.replace(/\.show$/i, ''),
              filename: file,
              category: rawData.category || 'unknown',
              slideCount: rawData.slides ? Object.keys(rawData.slides).length : 0,
              lastModified: stats.mtime.toISOString(),
              size: stats.size,
              mtimeMs: stats.mtimeMs,
              contentHash: allText.trim(),
              mediaInfo
            };

            setMemoryCacheEntry(file, showData);
            cacheUpdated = true;
          }

          showList.push({
            filename: showData.filename,
            name: showData.name,
            category: showData.category,
            modified: showData.mtimeMs,
            snippet: showData.contentHash.substring(0, 100).trim(),
            contentHash: showData.contentHash,
            mediaInfo: showData.mediaInfo
          });

        } catch (e) {
          console.error(`Error reading ${file}:`, e);
        }

        processedCount++;
        if (processedCount % 100 === 0) {
          await new Promise<void>(resolve => setImmediate(resolve));
        }
      }
    }

    if (cacheUpdated) {
      await saveCache();
    }

    // Identificeer duplicaten
    const groups: { [key: string]: ShowMeta[] } = {};
    const processed = new Set<string>();

    // Helper om namen te normaliseren
    const cleanName = (s: string) => s.toLowerCase()
      .replace(/^(ik weet|opwekking|lied|psalm|a|the|with|een|het|de|met)\s+/g, '')
      .replace(/\s+(we\s*\d+|copy|kopie|v\d+|\d+|[\(\)]+|[-_]+)/g, '')
      .replace(/[^a-z0-9]/g, '')
      .trim();

    // Pre-calculate attributes for O(1) checks in loop
    const enrichedList = showList.map(s => ({
      ...s,
      lowerName: s.name.toLowerCase(),
      cleanedName: cleanName(s.name),
      words: getWords(s.contentHash || '')
    }));

    for (let i = 0; i < enrichedList.length; i++) {
      if (processed.has(enrichedList[i].filename)) continue;
      
      const current = enrichedList[i];
      const matches = [current];
      processed.add(current.filename);

      for (let j = i + 1; j < enrichedList.length; j++) {
        const target = enrichedList[j];
        if (processed.has(target.filename)) continue;

        let isDuplicate = false;

        // 1. Exacte naam (binnen JSON)
        if (current.lowerName === target.lowerName) {
          isDuplicate = true;
        }

        // 1b. Genormaliseerde naam match (bijv. "Ik weet Mijn Verlosser Leeft" en "Mijn Verlosser Leeft")
        if (!isDuplicate && current.cleanedName && target.cleanedName) {
          if (current.cleanedName === target.cleanedName && current.cleanedName.length >= 4) {
            isDuplicate = true;
          }
        }

        // 2. Zeer gelijke bestandsnaam (fuzzy) - only check if length difference is <= 5
        if (!isDuplicate && Math.abs(current.filename.length - target.filename.length) <= 5) {
          const lFunc = typeof levenshtein === 'function' ? levenshtein : (levenshtein as any).levenshteinEditDistance;
          if (typeof lFunc === 'function') {
            const dist = lFunc(current.filename.toLowerCase(), target.filename.toLowerCase());
            // Match if filename is very close (e.g. distance <= 5) and contains typical duplicate markers
            const hasDuplicateMarker = 
              current.filename.includes('(') || target.filename.includes('(') ||
              current.filename.includes('-') || target.filename.includes('-') ||
              current.filename.toLowerCase().includes('copy') || target.filename.toLowerCase().includes('copy') ||
              current.filename.toLowerCase().includes('kopie') || target.filename.toLowerCase().includes('kopie') ||
              /\d/.test(current.filename) || /\d/.test(target.filename);
              
            if (dist <= 5 && hasDuplicateMarker) {
              isDuplicate = true;
            }
          }
        }

        // 3. Fuzzy inhoud (slides tekst) - Jaccard overlap - only check if size ratio is >= 0.75
        if (!isDuplicate && current.words.size > 0 && target.words.size > 0) {
          const minSize = Math.min(current.words.size, target.words.size);
          const maxSize = Math.max(current.words.size, target.words.size);
          if (minSize / maxSize >= 0.75) {
            const similarity = jaccardSimilarity(current.words, target.words);
            if (similarity >= 0.75) { // 75% overlap
              isDuplicate = true;
            }
          }
        }

        // 4. Fuzzy check op show namen (indien ze erg op elkaar lijken, bijv. "Lied 1" en "Lied 1a") - length diff <= 2
        if (!isDuplicate && current.name && target.name && Math.abs(current.name.length - target.name.length) <= 2) {
          const lFunc = typeof levenshtein === 'function' ? levenshtein : (levenshtein as any).levenshteinEditDistance;
          if (typeof lFunc === 'function') {
            const dist = lFunc(current.lowerName, target.lowerName);
            if (dist <= 2 && current.name.length >= 6) {
              isDuplicate = true;
            }
          }
        }

        if (isDuplicate) {
          matches.push(target);
          processed.add(target.filename);
        }
      }

      if (matches.length > 1) {
        groups[current.name || current.filename] = matches.map(m => ({
          filename: m.filename,
          name: m.name,
          category: m.category,
          modified: m.modified,
          snippet: m.snippet,
          contentHash: m.contentHash,
          mediaInfo: m.mediaInfo
        }));
      }
    }

    return NextResponse.json({ success: true, groups: Object.values(groups) });

  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
