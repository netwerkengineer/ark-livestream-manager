import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized } from '@/lib/authHelper';
import { getSettings } from '@/lib/settingsStore';
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

    // Zoek naar de state JSON file
    const stateFile = zip.file("livestream_state.json");
    if (!stateFile) {
      return NextResponse.json({ 
        error: "Geen laadbare project-status (livestream_state.json) gevonden in dit bestand. Alleen projecten die recent zijn opgeslagen met deze functie kunnen worden ingeladen." 
      }, { status: 400 });
    }

    const stateJsonStr = await stateFile.async("string");
    const stateObj = JSON.parse(stateJsonStr);

    return NextResponse.json({ success: true, state: stateObj });

  } catch (error: any) {
    console.error("Load project error:", error);
    return NextResponse.json({ error: "Fout bij inladen van het project: " + error.message }, { status: 500 });
  }
}
