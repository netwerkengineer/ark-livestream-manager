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

// Dezelfde link wordt maar één keer tegelijk gedownload: een tweede aanroep (bijv. het
// bijwerken van het project terwijl de download nog loopt) wacht op dezelfde download.
export function downloadYoutubeVideo(url: string, dir: string): Promise<Resultaat> {
  const key = `${dir}|${url}`;
  let p = lopend.get(key);
  if (!p) {
    p = downloadYoutubeVideoNu(url, dir).finally(() => lopend.delete(key));
    lopend.set(key, p);
  }
  return p;
}

async function downloadYoutubeVideoNu(url: string, dir: string): Promise<Resultaat> {
  if (!YOUTUBE_URL_RE.test(url)) return null;
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const { stdout: metadataJson } = await execFilePromise('yt-dlp', ['--dump-json', '--skip-download', url], { maxBuffer: 64 * 1024 * 1024 });
    const metadata = JSON.parse(metadataJson);
    const videoTitle = (metadata.title || 'video').replace(/[\\/:*?"<>|]/g, '-').trim();
    const finalPath = path.join(dir, `${videoTitle}.mp4`);
    if (fs.existsSync(finalPath)) return { filePath: finalPath, title: videoTitle };

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
    return null;
  }
}
