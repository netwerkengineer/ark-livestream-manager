import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized } from '@/lib/authHelper';
import { getSettings } from '@/lib/settingsStore';
import { reconstructManualItemsFromProject } from '@/lib/freeshowUtils';
import fs from 'fs/promises';
import path from 'path';
import JSZip from 'jszip';

export async function POST(req: NextRequest) {
  try {
    const authSession = await isAuthorized(req, undefined, "freeshow");
    if (!authSession) {
      return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
    }

    const { filename } = await req.json();
    if (!filename) {
      return NextResponse.json({ error: "Geen bestandsnaam opgegeven" }, { status: 400 });
    }

    const settings = getSettings() as any;
    if (!settings.freeshowProjectPath) {
      return NextResponse.json({ error: "Freeshow projectmap is niet ingesteld" }, { status: 400 });
    }

    // Safety check against path traversal
    const safeFilename = path.basename(filename);
    const filePath = path.join(settings.freeshowProjectPath, safeFilename);

    try {
      await fs.access(filePath);
    } catch {
      return NextResponse.json({ error: `Bestand niet gevonden: ${safeFilename}` }, { status: 404 });
    }

    const fileBuffer = await fs.readFile(filePath);
    const zip = await JSZip.loadAsync(fileBuffer);

    const dataJsonFile = zip.file("data.json");
    if (!dataJsonFile) {
      return NextResponse.json({ error: "Ongeldig .project bestand: geen data.json gevonden." }, { status: 400 });
    }
    const dataJson = JSON.parse(await dataJsonFile.async("string"));

    // livestream_state.json (when present) has two different shapes
    // depending on how the project was generated: {manualItems,
    // projectName, useTemplate} from the manual Bouwer, or
    // {draftServiceDate} from the email-automation pipeline
    // (draftProjectGenerator.ts). Only the former is a ready-made Bouwer
    // playlist - anything else (email-generated, or a project with no
    // livestream_state.json at all because it was authored natively in
    // FreeShow) falls back to reconstructing a best-effort playlist
    // straight from the project's own show data instead of refusing to load
    // at all.
    let manualItems: any[] | null = null;
    const stateFile = zip.file("livestream_state.json");
    if (stateFile) {
      try {
        const stateObj = JSON.parse(await stateFile.async("string"));
        if (Array.isArray(stateObj.manualItems)) {
          manualItems = stateObj.manualItems;
        }
      } catch (err) {
        console.error("Load project: livestream_state.json parse error:", err);
      }
    }

    let reconstructed = false;
    let skipped = 0;
    if (!manualItems) {
      const result = reconstructManualItemsFromProject(dataJson);
      manualItems = result.items;
      skipped = result.skipped;
      reconstructed = true;
    }

    return NextResponse.json({
      success: true,
      state: { manualItems, projectName: dataJson.project?.name, useTemplate: false },
      reconstructed,
      skipped
    });

  } catch (error: any) {
    console.error("Load project error:", error);
    return NextResponse.json({ error: "Fout bij inladen van het project: " + error.message }, { status: 500 });
  }
}
