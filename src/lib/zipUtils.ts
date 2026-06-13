import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';

async function countFiles(dir: string): Promise<number> {
  let count = 0;
  try {
    const items = await fs.readdir(dir, { withFileTypes: true });
    for (const item of items) {
      if (item.name === 'backups' && dir.endsWith('data')) continue;
      
      const itemPath = path.join(dir, item.name);
      
      // Resolve symlinks to count files inside target directory
      let isDir = item.isDirectory();
      if (item.isSymbolicLink()) {
        try {
          const stat = await fs.stat(itemPath);
          isDir = stat.isDirectory();
        } catch (e) {}
      }

      if (isDir) {
        count += await countFiles(itemPath);
      } else {
        count++;
      }
    }
  } catch (e) {}
  return count;
}

export async function generateBackup(
  targets: string[],
  includeMedia: boolean,
  settings: any,
  outputPath: string,
  onProgress?: (percent: number) => void
): Promise<void> {
  const tempDir = path.join(process.cwd(), 'data', 'backups', `temp_zip_${Date.now()}`);
  await fs.mkdir(tempDir, { recursive: true });

  try {
    // 1. Config Backup
    if (targets.includes('config')) {
      const dataDir = path.join(process.cwd(), 'data');
      const zipDataDir = path.join(tempDir, 'data');
      await fs.mkdir(zipDataDir, { recursive: true });
      
      const items = await fs.readdir(dataDir);
      for (const item of items) {
        if (item === 'backups' || item === 'backup_progress.json' || item.startsWith('temp_zip_')) {
          continue;
        }
        await fs.symlink(path.join(dataDir, item), path.join(zipDataDir, item));
      }
    }

    // 2. QLC+ Backup
    if (targets.includes('qlc')) {
      const zipQlcDir = path.join(tempDir, 'config');
      await fs.mkdir(zipQlcDir, { recursive: true });
      
      const qxwFile = path.join(process.cwd(), 'config', 'ark_church_lighting.qxw');
      try {
        await fs.access(qxwFile);
        await fs.symlink(qxwFile, path.join(zipQlcDir, 'ark_church_lighting.qxw'));
      } catch (e) {}

      const qlcConfigDir = path.join(process.cwd(), 'config', 'qlcplus', 'config');
      try {
        await fs.access(qlcConfigDir);
        const zipQlcConfigDir = path.join(zipQlcDir, 'qlcplus');
        await fs.mkdir(zipQlcConfigDir, { recursive: true });
        await fs.symlink(qlcConfigDir, path.join(zipQlcConfigDir, 'config'));
      } catch (e) {}
    }

    // 3. Companion Backup
    if (targets.includes('companion')) {
      const companionDir = path.join(process.cwd(), 'companion-data');
      try {
        await fs.access(companionDir);
        await fs.symlink(companionDir, path.join(tempDir, 'companion-data'));
      } catch (e) {}
    }

    // 4. FreeShow Backup
    if (targets.includes('freeshow')) {
      const freeshowPath = settings.freeshowPath || '';
      const freeshowProjectPath = settings.freeshowProjectPath || '';
      const freeshowMediaPath = settings.freeshowMediaPath || '';

      if (freeshowPath) {
        const zipFsDir = path.join(tempDir, 'FreeShow');
        await fs.mkdir(zipFsDir, { recursive: true });

        const showsDir = path.join(freeshowPath, 'Shows');
        try {
          await fs.access(showsDir);
          await fs.symlink(showsDir, path.join(zipFsDir, 'Shows'));
        } catch (e) {}

        const biblesDir = path.join(freeshowPath, 'Bibles');
        try {
          await fs.access(biblesDir);
          await fs.symlink(biblesDir, path.join(zipFsDir, 'Bibles'));
        } catch (e) {}

        const projectsDir = freeshowProjectPath || path.join(freeshowPath, 'projects');
        try {
          await fs.access(projectsDir);
          await fs.symlink(projectsDir, path.join(zipFsDir, 'projects'));
        } catch (e) {}

        if (includeMedia) {
          const mediaDir = freeshowMediaPath || path.join(freeshowPath, 'Media');
          try {
            await fs.access(mediaDir);
            await fs.symlink(mediaDir, path.join(zipFsDir, 'Media'));
          } catch (e) {}
        }
      }
    }

    // Count files recursively inside tempDir by following symlinks
    const totalFiles = await countFiles(tempDir);
    console.log(`Zipping total of ${totalFiles} files...`);

    // Ensure parent directory of outputPath exists
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    // Remove existing file if any
    await fs.unlink(outputPath).catch(() => {});

    // Spawn native zip command
    // We execute "zip -r outputPath ." inside tempDir
    return await new Promise<void>((resolve, reject) => {
      const zipProc = spawn('zip', ['-r', outputPath, '.'], { cwd: tempDir });

      let addedFiles = 0;
      let lastReportedPercent = -1;

      let stderrOutput = '';
      zipProc.stderr.on('data', (data) => {
        stderrOutput += data.toString();
      });

      zipProc.stdout.on('data', (data) => {
        const lines = data.toString().split('\n');
        for (const line of lines) {
          if (line.includes('adding:')) {
            addedFiles++;
            if (totalFiles > 0 && onProgress) {
              const percent = Math.min(99, Math.round((addedFiles / totalFiles) * 100));
              if (percent !== lastReportedPercent) {
                lastReportedPercent = percent;
                onProgress(percent);
              }
            }
          }
        }
      });

      zipProc.on('close', (code) => {
        if (code === 0 || code === 18) {
          if (code === 18) {
            console.warn(`Zip process completed with warnings (code 18). Stderr: ${stderrOutput}`);
          }
          if (onProgress) onProgress(100);
          resolve();
        } else {
          console.error(`Zip process failed. Stderr: ${stderrOutput}`);
          reject(new Error(`Zip process exited with code ${code}. Stderr: ${stderrOutput}`));
        }
      });

      zipProc.on('error', (err) => {
        reject(err);
      });
    });

  } finally {
    // Cleanup the tempDir
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

export function generateStreamBackup(
  targets: string[],
  includeMedia: boolean,
  settings: any,
  onProgress?: (percent: number) => void
): { stream: any; cleanup: () => Promise<void> } {
  const tempDir = path.join(process.cwd(), 'data', 'backups', `temp_zip_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`);
  
  const { PassThrough } = require('stream');
  const outStream = new PassThrough();
  
  let zipProc: any = null;
  let tempDirCreated = false;
  
  const cleanup = async () => {
    if (zipProc) {
      try { zipProc.kill(); } catch (e) {}
      zipProc = null;
    }
    if (tempDirCreated) {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
      tempDirCreated = false;
    }
  };

  (async () => {
    try {
      await fs.mkdir(tempDir, { recursive: true });
      tempDirCreated = true;

      // 1. Config Backup
      if (targets.includes('config')) {
        const dataDir = path.join(process.cwd(), 'data');
        const zipDataDir = path.join(tempDir, 'data');
        await fs.mkdir(zipDataDir, { recursive: true });
        
        const items = await fs.readdir(dataDir);
        for (const item of items) {
          if (item === 'backups' || item === 'backup_progress.json' || item.startsWith('temp_zip_')) {
            continue;
          }
          await fs.symlink(path.join(dataDir, item), path.join(zipDataDir, item));
        }
      }

      // 2. QLC+ Backup
      if (targets.includes('qlc')) {
        const zipQlcDir = path.join(tempDir, 'config');
        await fs.mkdir(zipQlcDir, { recursive: true });
        
        const qxwFile = path.join(process.cwd(), 'config', 'ark_church_lighting.qxw');
        try {
          await fs.access(qxwFile);
          await fs.symlink(qxwFile, path.join(zipQlcDir, 'ark_church_lighting.qxw'));
        } catch (e) {}

        const qlcConfigDir = path.join(process.cwd(), 'config', 'qlcplus', 'config');
        try {
          await fs.access(qlcConfigDir);
          const zipQlcConfigDir = path.join(zipQlcDir, 'qlcplus');
          await fs.mkdir(zipQlcConfigDir, { recursive: true });
          await fs.symlink(qlcConfigDir, path.join(zipQlcConfigDir, 'config'));
        } catch (e) {}
      }

      // 3. Companion Backup
      if (targets.includes('companion')) {
        const companionDir = path.join(process.cwd(), 'companion-data');
        try {
          await fs.access(companionDir);
          await fs.symlink(companionDir, path.join(tempDir, 'companion-data'));
        } catch (e) {}
      }

      // 4. FreeShow Backup
      if (targets.includes('freeshow')) {
        const freeshowPath = settings.freeshowPath || '';
        const freeshowProjectPath = settings.freeshowProjectPath || '';
        const freeshowMediaPath = settings.freeshowMediaPath || '';

        if (freeshowPath) {
          const zipFsDir = path.join(tempDir, 'FreeShow');
          await fs.mkdir(zipFsDir, { recursive: true });

          const showsDir = path.join(freeshowPath, 'Shows');
          try {
            await fs.access(showsDir);
            await fs.symlink(showsDir, path.join(zipFsDir, 'Shows'));
          } catch (e) {}

          const biblesDir = path.join(freeshowPath, 'Bibles');
          try {
            await fs.access(biblesDir);
            await fs.symlink(biblesDir, path.join(zipFsDir, 'Bibles'));
          } catch (e) {}

          const projectsDir = freeshowProjectPath || path.join(freeshowPath, 'projects');
          try {
            await fs.access(projectsDir);
            await fs.symlink(projectsDir, path.join(zipFsDir, 'projects'));
          } catch (e) {}

          if (includeMedia) {
            const mediaDir = freeshowMediaPath || path.join(freeshowPath, 'Media');
            try {
              await fs.access(mediaDir);
              await fs.symlink(mediaDir, path.join(zipFsDir, 'Media'));
            } catch (e) {}
          }
        }
      }

      let totalFiles = 0;
      countFiles(tempDir).then(count => {
        totalFiles = count;
        console.log(`Zipping total of ${totalFiles} files in stream mode...`);
      }).catch(e => {
        console.error("Error counting files:", e);
      });

      zipProc = spawn('zip', ['-r', '-', '.'], { cwd: tempDir });

      let addedFiles = 0;
      let lastReportedPercent = -1;
      let stderrOutput = '';

      zipProc.stderr.on('data', (data: any) => {
        const str = data.toString();
        stderrOutput += str;
        const lines = str.split('\n');
        for (const line of lines) {
          if (line.includes('adding:')) {
            addedFiles++;
            if (totalFiles > 0 && onProgress) {
              const percent = Math.min(99, Math.round((addedFiles / totalFiles) * 100));
              if (percent !== lastReportedPercent) {
                lastReportedPercent = percent;
                onProgress(percent);
              }
            }
          }
        }
      });

      zipProc.stdout.pipe(outStream);

      zipProc.on('close', (code: number) => {
        if (code === 0 || code === 18) {
          if (code === 18) {
            console.warn(`Zip stream process completed with warnings (code 18). Stderr: ${stderrOutput}`);
          }
          if (onProgress) onProgress(100);
          cleanup();
        } else {
          console.error(`Zip stream process failed (code ${code}). Stderr: ${stderrOutput}`);
          outStream.destroy(new Error(`Zip process exited with code ${code}. Stderr: ${stderrOutput}`));
          cleanup();
        }
      });

      zipProc.on('error', (err: any) => {
        console.error("Zip stream spawn error:", err);
        outStream.destroy(err);
        cleanup();
      });

    } catch (err: any) {
      console.error("Error setting up zip stream:", err);
      outStream.destroy(err);
      await cleanup();
    }
  })();

  return { stream: outStream, cleanup };
}


