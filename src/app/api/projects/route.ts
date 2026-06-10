import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { isAuthorized } from '@/lib/authHelper';
import { getSettings } from '@/lib/settingsStore';

export async function GET(req: NextRequest) {
  try {
    const authSession = await isAuthorized(req);
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
