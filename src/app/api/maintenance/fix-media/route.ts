import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { isAuthorized } from '@/lib/authHelper';
import { getSettings } from '@/lib/settingsStore';

// Traverse JSON structure and find all strings that look like paths containing FreeShow or folders
function findPaths(obj: any, paths: { val: string; key: string | number; parent: any }[] = []) {
  if (typeof obj === 'object' && obj !== null) {
    for (const k in obj) {
      const val = obj[k];
      if (typeof val === 'string') {
        const clean = val.replace(/\\/g, '/');
        if (
          clean.includes('FreeShow/') || 
          clean.includes('/Imports/') || 
          clean.includes('/Downloads/') || 
          clean.startsWith('Z:') || 
          clean.startsWith('C:') || 
          clean.startsWith('/Users/') ||
          clean.startsWith('/volume1/')
        ) {
          paths.push({ val, key: k, parent: obj });
        }
      } else {
        findPaths(val, paths);
      }
    }
  }
  return paths;
}

// Recursively find a file by base name or exact name under a directory
async function findFileRecursively(dir: string, filename: string): Promise<string | null> {
  const cleanFilename = filename.toLowerCase();
  
  // Extract base name without random suffix (e.g. "1_i2058233630.png" -> "1.png", "thema_a123.jpg" -> "thema.jpg")
  const cleanBase = filename.replace(/_[ia]\d+/i, '').replace(/_[a-f0-9]{8,15}/i, '').toLowerCase();

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    
    // Check files first in this directory
    for (const entry of entries) {
      if (entry.isFile()) {
        const nameLower = entry.name.toLowerCase();
        if (nameLower === cleanFilename) {
          return path.join(dir, entry.name);
        }
        const entryBase = entry.name.replace(/_[ia]\d+/i, '').replace(/_[a-f0-9]{8,15}/i, '').toLowerCase();
        if (entryBase === cleanBase) {
          return path.join(dir, entry.name);
        }
      }
    }

    // Traverse subdirectories
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name !== '@eaDir' && entry.name !== '.trash') {
        const found = await findFileRecursively(path.join(dir, entry.name), filename);
        if (found) return found;
      }
    }
  } catch (e) {}
  return null;
}

// Generate symlinks for folders with random suffixes (e.g. "Presentation_a123" -> "Presentation")
async function createMediaSymlinks(mediaDir: string) {
  const createdSymlinks: string[] = [];
  try {
    const entries = await fs.readdir(mediaDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const match = entry.name.match(/^(.*)_[a-f0-9]+$/i) || entry.name.match(/^(.*)_a\d+$/i);
        if (match) {
          const unsuffixedName = match[1].trim();
          const unsuffixedPath = path.join(mediaDir, unsuffixedName);
          try {
            await fs.access(unsuffixedPath);
          } catch (e) {
            // Unsuffixed folder does not exist, create relative symlink
            await fs.symlink(entry.name, unsuffixedPath, 'dir');
            createdSymlinks.push(`${unsuffixedName} -> ${entry.name}`);
          }
        }
      }
    }
  } catch (err) {
    console.error('Error creating symlinks:', err);
  }
  return createdSymlinks;
}

export async function GET(req: NextRequest) {
  try {
    const authSession = await isAuthorized(req, undefined, "freeshow");
    if (!authSession) {
      return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
    }

    const settings = getSettings() as any;
    const freeshowPath = settings.freeshowPath || '';

    if (!freeshowPath) {
      return NextResponse.json({ success: false, error: 'FreeShow path not configured' }, { status: 400 });
    }

    const showsDir = path.join(freeshowPath, 'Shows');
    const mediaDir = path.join(freeshowPath, 'Media');
    
    // 1. Create Media and Media/Imports directory
    const targetImportsMediaDir = path.join(mediaDir, 'Imports');
    await fs.mkdir(targetImportsMediaDir, { recursive: true });

    // 2. Generate symlinks in Media directory
    const symlinksCreated = await createMediaSymlinks(mediaDir);

    const files = await fs.readdir(showsDir);
    let showsScanned = 0;
    let pathsFixed = 0;
    let filesCopied = 0;
    const details: string[] = [];

    for (const file of files) {
      if (file.toLowerCase().endsWith('.show')) {
        showsScanned++;
        const filePath = path.join(showsDir, file);
        let contentStr = await fs.readFile(filePath, 'utf-8');
        let showObj;
        try {
          showObj = JSON.parse(contentStr);
        } catch (e) {
          continue;
        }

        const foundPathRefs = findPaths(showObj);
        let showModified = false;

        for (const ref of foundPathRefs) {
          const cleanPath = ref.val.replace(/\\/g, '/');
          const filename = cleanPath.split('/').pop() || '';
          if (!filename) continue;

          // Target path format inside Media folder: Z:\FreeShow\Media\...
          let resolvedMediaPath: string | null = null;

          // 1. Try to find the file recursively inside the Media directory
          const existingInMedia = await findFileRecursively(mediaDir, filename);
          if (existingInMedia) {
            resolvedMediaPath = existingInMedia;
          } else {
            // 2. If not found in Media, search the rest of the FreeShow directory (e.g. Imports)
            const foundElsewhere = await findFileRecursively(freeshowPath, filename);
            if (foundElsewhere) {
              // Copy to Media/Imports
              const destPath = path.join(targetImportsMediaDir, path.basename(foundElsewhere));
              try {
                await fs.copyFile(foundElsewhere, destPath);
                filesCopied++;
                resolvedMediaPath = destPath;
              } catch (copyErr) {
                console.error(`Failed to copy ${foundElsewhere} to ${destPath}:`, copyErr);
              }
            }
          }

          // If we found/copied the file to Media, rewrite the path
          if (resolvedMediaPath) {
            // Translate the absolute NAS path to Windows-style Z:\FreeShow\Media\... path
            const relPathInMedia = path.relative(mediaDir, resolvedMediaPath);
            const winPath = `Z:\\FreeShow\\Media\\${relPathInMedia.replace(/\//g, '\\')}`;
            
            if (ref.parent[ref.key] !== winPath) {
              ref.parent[ref.key] = winPath;
              showModified = true;
              pathsFixed++;
            }
          }
        }

        if (showModified) {
          await fs.writeFile(filePath, JSON.stringify(showObj, null, 2), 'utf-8');
          details.push(`Updated paths in ${file}`);
        }
      }
    }

    return NextResponse.json({
      success: true,
      showsScanned,
      pathsFixed,
      filesCopied,
      symlinksCreated: symlinksCreated.length,
      symlinkDetails: symlinksCreated,
      details
    });

  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
