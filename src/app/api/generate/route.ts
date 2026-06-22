import { NextRequest, NextResponse } from 'next/server';
import { createFreeShowProject, serializeProject } from '@/lib/freeshow';
import { isAuthorized } from '@/lib/authHelper';
import { getSettings } from '@/lib/settingsStore';
import fs from 'fs/promises';
import path from 'path';

export async function POST(req: NextRequest) {
  try {
    const authSession = await isAuthorized(req, undefined, "freeshow");
    if (!authSession) {
      return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
    }

    const { date, projectName, items, useTemplate, saveToNas, projectPath } = await req.json();
    const showsList: any[] = [];
    
    // 1. Find the template path to use
    let DEFAULT_TEMPLATE_PATH = "";
    
    // Check settings for custom template
    try {
      const settings = getSettings() as any;
      if (settings.defaultTemplate && settings.freeshowProjectPath) {
        const customPath = path.join(settings.freeshowProjectPath, settings.defaultTemplate);
        try {
          await fs.access(customPath);
          DEFAULT_TEMPLATE_PATH = customPath;
        } catch {}
      }
    } catch(e) {}

    // Fallback if not found
    if (!DEFAULT_TEMPLATE_PATH) {
      const possiblePaths = [
        path.join(process.cwd(), 'data', 'template.project'),
        '/app/data/template.project',
        './data/template.project'
      ];
      for (const p of possiblePaths) {
        try {
          await fs.access(p);
          DEFAULT_TEMPLATE_PATH = p;
          break;
        } catch {}
      }
    }

    if (!DEFAULT_TEMPLATE_PATH) {
      throw new Error("Geen template bestand gevonden op de server.");
    }

    // Use pure alphanumeric 11-char IDs like FreeShow
    const generateId = () => Math.random().toString(36).padEnd(15, '0').substring(2, 13);

    items.forEach((item: any) => {
      const sanitizeName = (name: string) => name.replace(/[\\/:*?"<>|]/g, ' ').trim();
      const showId = item.id || generateId();

      // Basis info die altijd mee moet
      const baseShow: any = {
        id: showId,
        type: item.type,
        source: item.source,
        isRemoved: item.isRemoved,
        swappedMediaPath: item.swappedMediaPath,
        targetSection: item.targetSection
      };

      if (item.type === 'song') {
        showsList.push({
          ...baseShow,
          fullData: item.fullData,
          backgroundMedia: item.backgroundMedia,
          backgroundType: item.backgroundType,
          data: {
            name: sanitizeName(`${item.title}${item.artist ? ' - ' + item.artist : ''}`),
            category: "song",
            text: item.text
          }
        });
      } else if (item.type === 'bible') {
        showsList.push({
          ...baseShow,
          refData: item.bibleData,
          backgroundMedia: item.backgroundMedia,
          backgroundType: item.backgroundType,
          data: {
            name: sanitizeName(`${item.ref} - ${item.translation}`),
            category: "scripture",
            text: item.text
          }
        });
      } else if (item.type === 'youtube') {
        showsList.push({
          ...baseShow,
          videoId: item.videoId,
          title: item.title
        });
      } else if (item.type === 'media') {
        showsList.push({
          ...baseShow,
          filePath: item.filePath,
          metaType: item.metaType,
          title: item.title
        });
      } else if (item.type === 'section') {
        showsList.push({
          ...baseShow,
          title: item.title,
          color: item.color
        });
      } else if (item.type === 'complex-show') {
         showsList.push({
           ...baseShow,
           title: item.title,
           slides: item.slides
         });
      } else if (item.source === 'template') {
        // Voor template items die geen specifieke data-wijziging hebben behalve eventueel swappedMediaPath
        showsList.push(baseShow);
      }
    });

    const dataJson = await createFreeShowProject(date, showsList, projectName, DEFAULT_TEMPLATE_PATH, useTemplate);
    
    // Save state so we can re-import later
    const generatorState = {
      manualItems: items,
      projectName: projectName,
      useTemplate: useTemplate
    };
    
    const serialized = await serializeProject(dataJson, generatorState);
    const filename = projectName ? `${projectName.replace(/[\\/:*?"<>|]/g, '-')}.project` : `Project-${date.replace(/\//g, '-')}.project`;

    // Save directly to NAS if requested
    if (saveToNas && projectPath) {
      try {
        await fs.mkdir(projectPath, { recursive: true });
        const filePath = path.join(projectPath, filename);
        await fs.writeFile(filePath, serialized);
        return NextResponse.json({ success: true, message: `Saved as ${filename}` });
      } catch (fsError: any) {
        console.error("FS Error:", fsError);
        return NextResponse.json({ success: false, error: `Cannot write to ${projectPath}: ${fsError.message}` });
      }
    }

    // Otherwise return as download
    return new NextResponse(serialized as any, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename=${filename}`
      }
    });

  } catch (error: any) {
    console.error("Generation error:", error);
    return NextResponse.json({ error: "Failed to generate project" }, { status: 500 });
  }
}
