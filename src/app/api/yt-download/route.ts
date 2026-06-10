import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);

import { isAuthorized } from '@/lib/authHelper';

export async function POST(req: NextRequest) {
  try {
    const authSession = await isAuthorized(req);
    if (!authSession) {
      return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
    }

    const { url, directory } = await req.json();

    if (!url || !directory) {
      return NextResponse.json({ error: 'URL of directory ontbreekt.' }, { status: 400 });
    }

    // 1. Haal video metadata op via yt-dlp (zonder te downloaden)
    console.log(`Metadata ophalen voor: ${url}`);
    const { stdout: metadataJson } = await execPromise(
      `yt-dlp --dump-json --skip-download "${url}"`
    );
    const metadata = JSON.parse(metadataJson);
    
    const videoTitle = metadata.title.replace(/[\\/:*?"<>|]/g, '-').trim() || 'video';
    const fileName = `${videoTitle}.mp4`;
    const finalPath = path.join(directory, fileName);

    // 2. Zorg dat de map bestaat
    await fs.mkdir(directory, { recursive: true });

    // 3. De echte download & muxing actie
    // -f "bestvideo[getheight<=1080]+bestaudio/best" zorgt voor 1080p
    // --merge-output-format mp4 zorgt voor de juiste container
    console.log(`Start yt-dlp download: ${videoTitle} (1080p)`);
    
    const downloadCommand = `yt-dlp -f "bestvideo[height<=1080]+bestaudio/best" --merge-output-format mp4 -o "${finalPath}" "${url}"`;
    
    await execPromise(downloadCommand);
    
    console.log('yt-dlp download completed successfully.');

    return NextResponse.json({ 
      success: true, 
      message: `Video successfully downloaded in Full HD as ${fileName}`,
      filePath: finalPath,
      title: videoTitle
    });

  } catch (error: any) {
    console.error('yt-dlp Error:', error);
    return NextResponse.json({ error: 'Error downloading (yt-dlp 1080p): ' + (error.stderr || error.message) }, { status: 500 });
  }
}
