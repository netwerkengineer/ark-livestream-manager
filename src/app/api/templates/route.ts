import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

export async function GET() {
  try {
    let freeshowPath = "";

    // 1. Read settings.json
    const settingsPath = path.join(process.cwd(), 'data', 'settings.json');
    try {
      const settingsData = await fs.readFile(settingsPath, 'utf-8');
      const settings = JSON.parse(settingsData);
      if (settings.freeshowPath) {
        freeshowPath = settings.freeshowPath;
      }
    } catch (e) {}

    // 2. Check if path exists. If not, try fallback paths
    let resolvedPath = freeshowPath;
    let pathExists = false;
    if (resolvedPath) {
      try {
        await fs.access(resolvedPath);
        pathExists = true;
      } catch (e) {}
    }

    if (!pathExists) {
      const fallbacks = [
        '/Volumes/Beamer/FreeShow',
        '/volume1/Beamer/FreeShow',
        '/mnt/data/Projects/Beamer/FreeShow'
      ];
      for (const fb of fallbacks) {
        try {
          await fs.access(fb);
          resolvedPath = fb;
          pathExists = true;
          break;
        } catch (e) {}
      }
    }

    if (!pathExists || !resolvedPath) {
      return NextResponse.json({ success: false, error: "FreeShow directory niet gevonden op de server." }, { status: 404 });
    }

    // 3. Scan resolvedPath for files ending in .fstemplate
    const files = await fs.readdir(resolvedPath);
    const templateFiles = files.filter(f => f.toLowerCase().endsWith('.fstemplate'));

    const templates = [];
    for (const filename of templateFiles) {
      try {
        const filePath = path.join(resolvedPath, filename);
        const fileContent = await fs.readFile(filePath, 'utf-8');
        const parsed = JSON.parse(fileContent);
        templates.push({
          filename,
          name: parsed.name ? parsed.name.trim() : filename.replace(/\.fstemplate$/i, ''),
          color: parsed.color,
          category: parsed.category,
          items: parsed.items || []
        });
      } catch (e: any) {
        console.error(`Error parsing template ${filename}:`, e);
      }
    }

    return NextResponse.json({ success: true, templates });
  } catch (error: any) {
    console.error("Templates route error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
