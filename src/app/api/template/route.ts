import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import JSZip from 'jszip';
import { isAuthorized } from '@/lib/authHelper';
import { getSettings } from '@/lib/settingsStore';
import { getItemType } from '@/lib/freeshowUtils';

export async function GET(req: NextRequest) {
  try {
    const authSession = await isAuthorized(req, undefined, "freeshow");
    if (!authSession) {
      return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
    }

    let templatePath = "";
    
    // 1. Check if a custom template is set in settings
    try {
      const settings = getSettings() as any;
      if (settings.defaultTemplate && settings.freeshowProjectPath) {
        const customPath = path.join(settings.freeshowProjectPath, settings.defaultTemplate);
        try {
          await fs.access(customPath);
          templatePath = customPath;
        } catch {}
      }
    } catch(e) {}

    // 2. If no custom template or not found, try possible fallback paths
    if (!templatePath) {
      const possiblePaths = [
        path.join(process.cwd(), 'data', 'template.project'),
        '/app/data/template.project',
        './data/template.project'
      ];

      for (const p of possiblePaths) {
        try {
          await fs.access(p);
          templatePath = p;
          break;
        } catch {}
      }
    }

    if (!templatePath) {
      return NextResponse.json({ error: "Geen template gevonden op de server." }, { status: 404 });
    }

    const fileBuffer = await fs.readFile(templatePath);
    const zip = new JSZip();
    const content = await zip.loadAsync(fileBuffer);
    
    const dataJsonFile = content.file("data.json");
    if (!dataJsonFile) {
      return NextResponse.json({ error: "Ongeldig projectbestand: geen data.json gevonden." }, { status: 400 });
    }

    const dataJsonStr = await dataJsonFile.async("string");
    const data = JSON.parse(dataJsonStr);

    // Filter de shows en secties uit het project object
    const shows = data.project.shows.map((s: any) => {
      if (s.type === 'section') {
        return {
          id: s.id,
          type: 'section',
          title: s.name,
          color: s.color,
          index: s.index
        };
      } else {
        // Het is een show referentie
        const fullShow = data.shows[s.id];
        return {
          id: s.id,
          type: 'show',
          title: fullShow?.name || s.name || "Naamloze Show",
          index: s.index,
          // Check of het een media-gebaseerde show is (zoals Welkom)
          isMedia: fullShow?.category === 'media' || (fullShow?.slides && Object.values(fullShow.slides).some((sl: any) => sl.items && sl.items.some((i: any) => getItemType(i) === 'media')))
        };
      }
    });

    return NextResponse.json({
      name: data.project.name,
      id: data.project.id,
      shows: shows
    });

  } catch (error: any) {
    console.error("Template scan error:", error);
    return NextResponse.json({ error: "Error scanning template: " + error.message }, { status: 500 });
  }
}
