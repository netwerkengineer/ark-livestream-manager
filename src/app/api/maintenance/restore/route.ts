import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import JSZip from 'jszip';
import { isAuthorized } from '@/lib/authHelper';
import { getSettings } from '@/lib/settingsStore';

export async function POST(req: NextRequest) {
  try {
    const authSession = await isAuthorized(req, undefined, "freeshow");
    if (!authSession) {
      return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
    }

    const formData = await req.formData();
    const file = formData.get('file') as File;
    const targetsStr = formData.get('targets') as string;
    
    if (!file || !targetsStr) {
      return NextResponse.json({ error: "Geen bestand of doelen geselecteerd" }, { status: 400 });
    }

    const targets = targetsStr.split(',');
    const buffer = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(buffer);
    const settings = getSettings() as any;

    let restoredItems = [];

    // Helper function to extract a folder from zip
    const extractFolder = async (zipFolderPrefix: string, destPath: string) => {
      let extracted = 0;
      for (const relativePath of Object.keys(zip.files)) {
        if (relativePath.startsWith(zipFolderPrefix) && !zip.files[relativePath].dir) {
          // Remove the prefix to get the relative path inside the dest folder
          const destRelativePath = relativePath.slice(zipFolderPrefix.length);
          const finalPath = path.join(destPath, destRelativePath);
          
          await fs.mkdir(path.dirname(finalPath), { recursive: true });
          const content = await zip.files[relativePath].async('nodebuffer');
          await fs.writeFile(finalPath, content);
          extracted++;
        }
      }
      return extracted;
    };

    // 1. Restore Config
    if (targets.includes('config')) {
      const dest = path.join(process.cwd(), 'data');
      const count = await extractFolder('data/', dest);
      if (count > 0) restoredItems.push('Applicatie Configuratie');
    }

    // 2. Restore QLC+
    if (targets.includes('qlc')) {
      let count = 0;
      // QXW file
      const qxwFile = zip.file('config/ark_church_lighting.qxw');
      if (qxwFile) {
        const dest = path.join(process.cwd(), 'config', 'ark_church_lighting.qxw');
        await fs.writeFile(dest, await qxwFile.async('nodebuffer'));
        count++;
      }
      // Config folder
      count += await extractFolder('config/qlcplus/config/', path.join(process.cwd(), 'config', 'qlcplus', 'config'));
      if (count > 0) restoredItems.push('QLC+ Workspace');
    }

    // 3. Restore Companion
    if (targets.includes('companion')) {
      const dest = path.join(process.cwd(), 'companion-data');
      const count = await extractFolder('companion-data/', dest);
      if (count > 0) restoredItems.push('Bitfocus Companion');
    }

    // 4. Restore FreeShow
    if (targets.includes('freeshow')) {
      const freeshowPath = settings.freeshowPath || '';
      if (freeshowPath) {
        let count = 0;
        count += await extractFolder('FreeShow/Shows/', path.join(freeshowPath, 'Shows'));
        count += await extractFolder('FreeShow/Bibles/', path.join(freeshowPath, 'Bibles'));
        count += await extractFolder('FreeShow/projects/', settings.freeshowProjectPath || path.join(freeshowPath, 'projects'));
        count += await extractFolder('FreeShow/Media/', settings.freeshowMediaPath || path.join(freeshowPath, 'Media'));
        
        if (count > 0) restoredItems.push('FreeShow Database');
      }
    }

    // Attempt Docker Restart using unix socket
    let restartMessage = "Herstart a.u.b. de containers handmatig (Proxmox/Docker) om alle wijzigingen door te voeren.";
    try {
      const http = require('http');
      const restartContainer = (name: string) => {
        return new Promise((resolve) => {
          const req = http.request({
            socketPath: '/var/run/docker.sock',
            path: `/containers/${name}/restart`,
            method: 'POST'
          }, (res: any) => resolve(res.statusCode === 204));
          req.on('error', () => resolve(false));
          req.end();
        });
      };
      
      let anyRestarted = false;
      if (targets.includes('companion')) {
        const ok = await restartContainer('companion');
        if (ok) anyRestarted = true;
      }
      if (targets.includes('qlc')) {
        const ok = await restartContainer('qlcplus');
        if (ok) anyRestarted = true;
      }
      
      if (anyRestarted) {
        restartMessage = "Services succesvol herstart!";
      }
    } catch (e) {
      // Ignore if socket fails
    }

    return NextResponse.json({ 
      success: true, 
      message: `Hersteld: ${restoredItems.join(', ')}. ${restartMessage}` 
    });

  } catch (error: any) {
    console.error("Restore error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
