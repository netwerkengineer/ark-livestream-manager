import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFilePromise = promisify(execFile);
export const YOUTUBE_URL_RE = /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i;

// Downloads a YouTube link as a 1080p mp4 so it can be embedded as real media
// in a FreeShow project. Uses execFile (argument array, no shell) because the
// URL may come from an e-mail or a form. A file that is already there is reused.
type Resultaat = { filePath: string; title: string } | null;
const lopend = new Map<string, Promise<Resultaat>>();
const fouten = new Map<string, string>();

// Korte reden waarom de laatste download van deze link mislukte (voor in de setlist, zodat het zonder serverlogs te zien is)
export function youtubeFout(url: string): string {
  return fouten.get(url) || 'onbekende fout';
}

// Dezelfde link wordt maar één keer tegelijk gedownload: een tweede aanroep (bijv. het
// bijwerken van het project terwijl de download nog loopt) wacht op dezelfde download.
export function downloadYoutubeVideo(url: string, dir: string, audioOnly = false): Promise<Resultaat> {
  const key = `${dir}|${url}|${audioOnly ? 'audio' : 'video'}`;
  let p = lopend.get(key);
  if (!p) {
    p = downloadYoutubeVideoNu(url, dir, audioOnly).finally(() => lopend.delete(key));
    lopend.set(key, p);
  }
  return p;
}

async function downloadYoutubeVideoNu(url: string, dir: string, audioOnly: boolean): Promise<Resultaat> {
  if (!YOUTUBE_URL_RE.test(url)) { fouten.set(url, 'geen geldige YouTube-link'); return null; }
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const { stdout: metadataJson } = await execFilePromise('yt-dlp', ['--dump-json', '--skip-download', url], { maxBuffer: 64 * 1024 * 1024 });
    const metadata = JSON.parse(metadataJson);
    const videoTitle = (metadata.title || 'video').replace(/[\\/:*?"<>|]/g, '-').trim();
    const finalPath = path.join(dir, `${videoTitle}.${audioOnly ? 'm4a' : 'mp4'}`);
    if (fs.existsSync(finalPath)) return { filePath: finalPath, title: videoTitle };

    // Alleen audio: de beste audiostroom als m4a (AAC), geen videobeeld
    if (audioOnly) {
      await execFilePromise('yt-dlp', ['-f', 'bestaudio[ext=m4a]/bestaudio', '-x', '--audio-format', 'm4a', '-o', finalPath, url], { maxBuffer: 64 * 1024 * 1024 });
      return { filePath: finalPath, title: videoTitle };
    }

    // AV1 uitsluiten: FreeShow (Electron/Chromium) speelt AV1 niet
    // betrouwbaar af op de output - zie src/app/api/yt-download/route.ts
    await execFilePromise('yt-dlp', [
      '-f', 'bestvideo[height<=1080][vcodec!*=av01]+bestaudio/bestvideo[height<=1080]+bestaudio/best',
      '--merge-output-format', 'mp4',
      '-o', finalPath,
      url
    ], { maxBuffer: 64 * 1024 * 1024 });

    return { filePath: finalPath, title: videoTitle };
  } catch (err) {
    console.error(`[YouTube] Download mislukt voor ${url}:`, err);
    const e = err as any;
    const tekst = String(e?.stderr || e?.message || err).split('\n').map(r => r.trim()).filter(Boolean);
    fouten.set(url, (tekst.find(r => /^ERROR/i.test(r)) || tekst[tekst.length - 1] || 'onbekende fout').slice(0, 300));
    return null;
  }
}
