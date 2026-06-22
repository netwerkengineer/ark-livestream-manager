import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { isAuthorized } from '@/lib/authHelper';
import { getSettings } from '@/lib/settingsStore';

export async function GET(req: NextRequest) {
  try {
    const authSession = await isAuthorized(req, undefined, "freeshow");
    if (!authSession) {
      return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
    }

    const settings = getSettings() as any;
    const projectDir = settings.freeshowProjectPath || '';

    if (!projectDir) {
      return NextResponse.json({ success: true, projects: [] });
    }

    try {
      const files = await fs.readdir(projectDir);
      const projects = files
        .filter(f => f.toLowerCase().endsWith('.project'))
        .sort((a, b) => a.localeCompare(b));
        
      return NextResponse.json({ success: true, projects });
    } catch (err) {
      return NextResponse.json({ success: true, projects: [] });
    }
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const authSession = await isAuthorized(req, undefined, "freeshow");
    if (!authSession) {
      return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
    }

    const url = new URL(req.url);
    const filename = url.searchParams.get('filename');

    if (!filename || !filename.endsWith('.project') || filename.includes('/') || filename.includes('\\')) {
      return NextResponse.json({ error: "Ongeldige bestandsnaam" }, { status: 400 });
    }

    const settings = getSettings() as any;
    const projectDir = settings.freeshowProjectPath || '';

    if (!projectDir) {
      return NextResponse.json({ error: "Project directory niet geconfigureerd" }, { status: 400 });
    }

    const filePath = path.join(projectDir, filename);

    try {
      await fs.unlink(filePath);
      return NextResponse.json({ success: true });
    } catch (err) {
      return NextResponse.json({ error: "Bestand kon niet worden verwijderd" }, { status: 500 });
    }
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
