import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import * as ftp from "basic-ftp";
import { createClient } from "webdav";
import { isAuthorized } from '@/lib/authHelper';
import { getSettings } from '@/lib/settingsStore';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const secret = searchParams.get('secret');
    const settings = getSettings();

    // Als er een secret wordt meegegeven (voor scheduler), check die
    if (secret) {
      const expectedPin = (settings as any).adminPin;
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

    // Zoek het nieuwste backup bestand
    const backupDir = path.join(process.cwd(), 'data', 'backups');
    const files = await fs.readdir(backupDir);
    const zips = files.filter(f => f.endsWith('.zip')).sort().reverse();
    
    if (zips.length === 0) {
      return NextResponse.json({ error: 'Geen backup bestand gevonden om te verzenden' }, { status: 404 });
    }

    const latestBackup = path.join(backupDir, zips[0]);

    if (settings.backupTarget === 'ftp') {
      const client = new ftp.Client();
      client.ftp.verbose = true;
      try {
        await client.access({
          host: settings.ftpHost,
          user: settings.ftpUser,
          password: settings.ftpPass,
          port: settings.ftpPort || 21,
          secure: false // Vrijwel alle NAS systemen gebruiken standaard passieve FTP
        });
        await client.uploadFrom(latestBackup, zips[0]);
      } finally {
        client.close();
      }
    } 
    else if (settings.backupTarget === 'webdav') {
      const client = createClient(settings.webdavUrl || '', {
        username: settings.webdavUser,
        password: settings.webdavPass,
      });
      const fileData = await fs.readFile(latestBackup);
      await client.putFileContents(`/${zips[0]}`, fileData);
    }

    return NextResponse.json({ success: true, message: `Backup ${zips[0]} successfully sent to ${settings.backupTarget}` });

  } catch (error: any) {
    console.error("Remote backup error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
