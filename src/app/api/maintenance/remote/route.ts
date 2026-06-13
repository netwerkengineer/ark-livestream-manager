import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import * as ftp from "basic-ftp";
import { createClient } from "webdav";
import { isAuthorized } from '@/lib/authHelper';
import { getSettings } from '@/lib/settingsStore';

async function performRemoteBackupAsync(
  targets: string[],
  includeMedia: boolean,
  settings: any,
  filename: string,
  progressPath: string
) {
  let cleanupFn: (() => Promise<void>) | null = null;
  try {
    const { generateStreamBackup } = require('@/lib/zipUtils');
    
    if (settings.backupTarget === 'ftp') {
      const client = new ftp.Client();
      try {
        await client.access({
          host: settings.ftpHost,
          user: settings.ftpUser,
          password: settings.ftpPass,
          port: settings.ftpPort || 21,
          secure: false 
        });

        await fs.writeFile(progressPath, JSON.stringify({ status: 'zipping', percent: 0 }));

        const { stream: zipStream, cleanup } = generateStreamBackup(targets, includeMedia, settings, async (percent: number) => {
          if (percent % 5 === 0) {
            await fs.writeFile(progressPath, JSON.stringify({ status: 'zipping', percent })).catch(() => {});
          }
        });
        cleanupFn = cleanup;

        await client.uploadFrom(zipStream, filename);
        await fs.writeFile(progressPath, JSON.stringify({ status: 'completed', percent: 100 }));
      } finally {
        client.close();
      }
    } 
    else if (settings.backupTarget === 'webdav') {
      const client = createClient(settings.webdavUrl || '', {
        username: settings.webdavUser,
        password: settings.webdavPass,
      });
      
      const remotePath = `/${filename}`;
      console.log(`Starting background WebDAV upload to ${settings.webdavUrl} at path ${remotePath}...`);
      
      await fs.writeFile(progressPath, JSON.stringify({ status: 'zipping', percent: 0 }));

      const { stream: zipStream, cleanup } = generateStreamBackup(targets, includeMedia, settings, async (percent: number) => {
        if (percent % 5 === 0) {
          await fs.writeFile(progressPath, JSON.stringify({ status: 'zipping', percent })).catch(() => {});
        }
      });
      cleanupFn = cleanup;

      await client.putFileContents(remotePath, zipStream);
      await fs.writeFile(progressPath, JSON.stringify({ status: 'completed', percent: 100 }));
      console.log(`WebDAV upload successful for ${filename}`);
    }
  } catch (err: any) {
    console.error("Async Remote Backup failed:", err);
    await fs.writeFile(progressPath, JSON.stringify({ status: 'error', error: err.message })).catch(() => {});
  } finally {
    if (cleanupFn) {
      await cleanupFn().catch(() => {});
    }
  }
}

async function performRemoteBackup(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const secret = searchParams.get('secret');
  const settings = getSettings() as any;

  // Authorization Check
  if (secret) {
    const expectedPin = settings.adminPin;
    const expectedSecret = settings.nextAuthSecret;
    if (secret !== expectedPin && secret !== expectedSecret) {
       return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  } else {
    const authSession = await isAuthorized(req, undefined, "freeshow");
    if (!authSession) {
       return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  if (!settings || settings.backupTarget === 'none') {
    return NextResponse.json({ error: 'Geen remote backup doel ingesteld' }, { status: 400 });
  }

  const targetsParam = searchParams.get('targets') || 'config,qlc,companion,freeshow';
  const targets = targetsParam.split(',');
  const includeMedia = searchParams.get('includeMedia') === 'true';

  const prefix = settings.backupPrefix ? `${settings.backupPrefix}_` : 'ark_';
  const backupDate = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${prefix}backup_${backupDate}.zip`;
  
  const progressPath = path.join(process.cwd(), 'data', 'backup_progress.json');
  
  // Fire off background backup and upload
  performRemoteBackupAsync(targets, includeMedia, settings, filename, progressPath).catch(err => {
    console.error("Async background remote backup trigger error:", err);
  });

  return NextResponse.json({ success: true, status: 'started', filename });
}

export async function GET(req: NextRequest) {
  try {
    return await performRemoteBackup(req);
  } catch (error: any) {
    console.error("Remote backup error:", error);
    const progressPath = path.join(process.cwd(), 'data', 'backup_progress.json');
    await fs.writeFile(progressPath, JSON.stringify({ status: 'error', error: error.message })).catch(()=>{});
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    return await performRemoteBackup(req);
  } catch (error: any) {
    console.error("Remote backup error:", error);
    const progressPath = path.join(process.cwd(), 'data', 'backup_progress.json');
    await fs.writeFile(progressPath, JSON.stringify({ status: 'error', error: error.message })).catch(()=>{});
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
