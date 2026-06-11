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
    const authSession = await isAuthorized(req);
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
                  if (item.type === 'text' && item.lines) {
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

        // 2. Zeer gelijke bestandsnaam (fuzzy)
        if (!isDuplicate) {
          const lFunc = typeof levenshtein === 'function' ? levenshtein : (levenshtein as any).levenshteinEditDistance;
          if (typeof lFunc === 'function') {
            const dist = lFunc(current.filename.toLowerCase(), target.filename.toLowerCase());
            if (dist <= 4 && (current.filename.includes('(') || target.filename.includes('('))) {
              isDuplicate = true;
            }
          }
        }

        // 3. Exacte inhoud (slides tekst)
        if (!isDuplicate && current.contentHash && current.contentHash === target.contentHash) {
          isDuplicate = true;
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
