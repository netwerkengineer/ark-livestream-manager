import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import * as levenshteinModule from 'levenshtein-edit-distance';
import { isAuthorized } from '@/lib/authHelper';
import { getSettings } from '@/lib/settingsStore';
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
    const showList: ShowMeta[] = [];

    for (const file of files) {
      if (file.toLowerCase().endsWith('.show')) {
        try {
          const filePath = path.join(showsDir, file);
          const stats = await fs.stat(filePath);
          const content = await fs.readFile(filePath, 'utf-8');
          const json = JSON.parse(content);
          
          // Support both [id, data] array format and direct object format
          const showData = Array.isArray(json) && json.length === 2 ? json[1] : json;
          
          let mediaInfo = null;
          if (showData.media && Object.keys(showData.media).length > 0) {
            const firstMedia: any = Object.values(showData.media)[0];
            mediaInfo = { name: firstMedia.name, type: firstMedia.type };
          }

          // Extraheer alle tekst uit de slides voor een 'fingerprint'
          let allText = '';
          if (showData.slides) {
            Object.values(showData.slides).forEach((slide: any) => {
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

          showList.push({
            filename: file,
            name: showData.name || file.replace(/\.show$/i, ''),
            category: showData.category || 'unknown',
            modified: stats.mtimeMs,
            snippet: allText.substring(0, 100).trim(),
            contentHash: allText.trim(),
            mediaInfo
          });
        } catch (e) {
          console.error(`Error reading ${file}:`, e);
        }
      }
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

    for (let i = 0; i < showList.length; i++) {
      if (processed.has(showList[i].filename)) continue;
      
      const current = showList[i];
      const matches = [current];
      processed.add(current.filename);

      for (let j = i + 1; j < showList.length; j++) {
        const target = showList[j];
        if (processed.has(target.filename)) continue;

        let isDuplicate = false;

        // 1. Exacte naam (binnen JSON)
        if (current.name.toLowerCase() === target.name.toLowerCase()) {
          isDuplicate = true;
        }

        // 1b. Genormaliseerde naam match (bijv. "Ik weet Mijn Verlosser Leeft" en "Mijn Verlosser Leeft")
        if (!isDuplicate && current.name && target.name) {
          const n1 = cleanName(current.name);
          const n2 = cleanName(target.name);
          if (n1 === n2 && n1.length >= 4) {
            isDuplicate = true;
          }
        }

        // 2. Zeer gelijke bestandsnaam (fuzzy)
        if (!isDuplicate) {
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

        // 3. Fuzzy inhoud (slides tekst)
        if (!isDuplicate && current.contentHash && target.contentHash) {
          const len1 = current.contentHash.length;
          const len2 = target.contentHash.length;
          const maxLen = Math.max(len1, len2);
          
          // Only do expensive Levenshtein if lengths are within 25% of each other
          if (maxLen > 0 && Math.abs(len1 - len2) / maxLen <= 0.25) {
            const lFunc = typeof levenshtein === 'function' ? levenshtein : (levenshtein as any).levenshteinEditDistance;
            if (typeof lFunc === 'function') {
              const dist = lFunc(current.contentHash.toLowerCase(), target.contentHash.toLowerCase());
              const similarity = (maxLen - dist) / maxLen;
              if (similarity >= 0.88) { // 88% similarity
                isDuplicate = true;
              }
            }
          }
        }

        // 4. Fuzzy check op show namen (indien ze erg op elkaar lijken, bijv. "Lied 1" en "Lied 1a")
        if (!isDuplicate && current.name && target.name) {
          const lFunc = typeof levenshtein === 'function' ? levenshtein : (levenshtein as any).levenshteinEditDistance;
          if (typeof lFunc === 'function') {
            const dist = lFunc(current.name.toLowerCase(), target.name.toLowerCase());
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
        groups[current.name || current.filename] = matches;
      }
    }

    return NextResponse.json({ success: true, groups: Object.values(groups) });

  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
