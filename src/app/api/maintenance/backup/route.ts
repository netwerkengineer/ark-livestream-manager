import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { isAuthorized } from '@/lib/authHelper';
import { getSettings } from '@/lib/settingsStore';
import { generateStreamBackup } from '@/lib/zipUtils';

export async function GET(req: NextRequest) {
  try {
    const settings = getSettings() as any;
    const { searchParams } = new URL(req.url);
    const secret = searchParams.get('secret');
    
    let authorized = false;
    if (secret) {
      const expectedPin = settings.adminPin;
      const expectedSecret = settings.nextAuthSecret;
      if (secret === expectedPin || (expectedSecret && secret === expectedSecret)) {
        authorized = true;
      }
    } else {
      const authSession = await isAuthorized(req, undefined, "freeshow");
      if (authSession) {
        authorized = true;
      }
    }

    if (!authorized) {
      return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
    }

    const targetsParam = searchParams.get('targets') || 'freeshow';
    const targets = targetsParam.split(',');
    const includeMedia = searchParams.get('includeMedia') === 'true';
    const backupDate = new Date().toISOString().replace(/[:.]/g, '-');
    
    const prefix = settings.backupPrefix ? `${settings.backupPrefix}_` : 'ark_';
    const filename = `${prefix}backup_${backupDate}.zip`;

    // Write progress to file
    const progressPath = path.join(process.cwd(), 'data', 'backup_progress.json');
    await fs.writeFile(progressPath, JSON.stringify({ status: 'zipping', percent: 0 }));
    
    // Generate streaming backup
    const { stream: zipStream, cleanup } = generateStreamBackup(targets, includeMedia, settings, async (percent) => {
      // Write progress every 5%
      if (percent % 5 === 0) {
        await fs.writeFile(progressPath, JSON.stringify({ status: 'zipping', percent })).catch(() => {});
      }
    });

    // Listen to client abort
    let isClosed = false;
    req.signal.addEventListener('abort', () => {
      isClosed = true;
      cleanup();
    });

    const stream = new ReadableStream({
      start(controller) {
        zipStream.on('data', (chunk: any) => {
          if (!isClosed) {
            try {
              controller.enqueue(chunk);
            } catch (e) {
              isClosed = true;
              cleanup();
            }
          }
        });
        zipStream.on('end', async () => {
          if (!isClosed) {
            isClosed = true;
            await fs.writeFile(progressPath, JSON.stringify({ status: 'completed', percent: 100 })).catch(() => {});
            try {
              controller.close();
            } catch (e) {}
          }
        });
        zipStream.on('error', async (err: any) => {
          if (!isClosed) {
            isClosed = true;
            await fs.writeFile(progressPath, JSON.stringify({ status: 'error', error: err.message })).catch(() => {});
            try {
              controller.error(err);
            } catch (e) {}
          }
        });
      },
      cancel() {
        isClosed = true;
        cleanup();
      }
    });

    return new NextResponse(stream as any, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename=${filename}`
      }
    });

  } catch (error: any) {
    console.error("Local backup error:", error);
    const progressPath = path.join(process.cwd(), 'data', 'backup_progress.json');
    await fs.writeFile(progressPath, JSON.stringify({ status: 'error', error: error.message })).catch(() => {});
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
