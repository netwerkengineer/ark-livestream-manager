import fs from 'fs/promises';
import path from 'path';
import { getSettings } from '@/lib/settingsStore';

export async function checkLocalSongExists(title: string, artist: string): Promise<boolean> {
  let songDir = process.env.FREESHOW_SONGS_DIR || path.join(process.cwd(), 'database', 'songs');
  
  try {
    const settings = getSettings() as any;
    if (settings.freeshowPath) {
      songDir = path.join(settings.freeshowPath, 'Shows');
    }
  } catch(e) {}
  
  try {
    await fs.access(songDir);
    const files = await fs.readdir(songDir);
    
    // Check if any file matches the title and artist (ignoring case)
    const match = files.find(file => {
      const lowerFile = file.toLowerCase();
      const lowerTitle = title.toLowerCase();
      const lowerArtist = artist.toLowerCase();
      
      if (!lowerFile.endsWith('.show') && !lowerFile.endsWith('.json')) return false;
      
      return lowerFile.includes(lowerTitle) && lowerFile.includes(lowerArtist);
    });

    return !!match;
  } catch (err) {
    // Directory might not exist or error reading
    return false;
  }
}

export async function getLocalSongText(title: string, artist: string): Promise<string> {
  let songDir = process.env.FREESHOW_SONGS_DIR || path.join(process.cwd(), 'database', 'songs');
  
  try {
    const settings = getSettings() as any;
    if (settings.freeshowPath) {
      songDir = path.join(settings.freeshowPath, 'Shows');
    }
  } catch(e) {}

  try {
    const files = await fs.readdir(songDir);
    const match = files.find(file => {
      const lowerFile = file.toLowerCase();
      if (!lowerFile.endsWith('.show') && !lowerFile.endsWith('.json')) return false;
      return lowerFile.includes(title.toLowerCase()) && lowerFile.includes(artist.toLowerCase());
    });

    if (!match) return '';

    const filePath = path.join(songDir, match);
    const content = await fs.readFile(filePath, 'utf-8');
    const rawData = JSON.parse(content);
    
    // FreeShow .show files are typically an array [id, data]
    const showData = Array.isArray(rawData) ? rawData[1] : rawData;

    // Extract text from slides
    const lyricsParts: string[] = [];
    if (showData && showData.slides) {
      // Slides is an object with slide IDs as keys
      Object.values(showData.slides).forEach((slide: any) => {
        const slideTexts: string[] = [];
        if (slide.items) {
          slide.items.forEach((item: any) => {
            if (item.type === 'text' && item.lines) {
              item.lines.forEach((line: any) => {
                if (line.text) {
                  line.text.forEach((t: any) => {
                    if (t.value) slideTexts.push(t.value);
                  });
                }
              });
            }
          });
        }
        if (slideTexts.length > 0) {
          lyricsParts.push(slideTexts.join('\n'));
        }
      });
    }

    return lyricsParts.join('\n\n');
  } catch (err) {
    console.error("Local song text error:", err);
    return '';
  }
}

export async function getLocalShowData(title: string, artist: string): Promise<{ id: string, data: any } | null> {
  let songDir = process.env.FREESHOW_SONGS_DIR || path.join(process.cwd(), 'database', 'songs');
  
  try {
    const settings = getSettings() as any;
    if (settings.freeshowPath) {
      songDir = path.join(settings.freeshowPath, 'Shows');
    }
  } catch(e) {}

  try {
    const files = await fs.readdir(songDir);
    const match = files.find(file => {
      const lowerFile = file.toLowerCase();
      if (!lowerFile.endsWith('.show') && !lowerFile.endsWith('.json')) return false;
      return lowerFile.includes(title.toLowerCase()) && lowerFile.includes(artist.toLowerCase());
    });

    if (!match) return null;

    const filePath = path.join(songDir, match);
    const content = await fs.readFile(filePath, 'utf-8');
    const rawData = JSON.parse(content);
    
    if (Array.isArray(rawData)) {
      return { id: rawData[0], data: rawData[1] };
    }
    return { id: Math.random().toString(36).substring(2, 13), data: rawData };
  } catch (err) {
    console.error("Local show data error:", err);
    return null;
  }
}

export async function fetchLyricsFromInternet(title: string, artist: string): Promise<string> {
  try {
    const res = await fetch(`https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`);
    if (res.ok) {
      const data = await res.json();
      return data.lyrics || '';
    }
    return '';
  } catch (error) {
    console.error("Lyrics fetch error:", error);
    return '';
  }
}
