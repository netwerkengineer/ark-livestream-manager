import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { isAuthorized } from '@/lib/authHelper';
import { getSettings } from '@/lib/settingsStore';

export async function POST(request: NextRequest) {
  try {
    const authSession = await isAuthorized(request);
    if (!authSession) {
      return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
    }

    const settings = getSettings() as any;
    const freeshowPath = settings.freeshowPath || '';
    if (!freeshowPath) {
      return NextResponse.json({ success: false, error: 'FreeShow path not configured' }, { status: 400 });
    }

    const { filename, newTitle } = await request.json();
    if (!filename || !newTitle) {
      return NextResponse.json({ success: false, error: 'Filename and newTitle are required' }, { status: 400 });
    }

    const showsDir = path.join(freeshowPath, 'Shows');
    const oldFilePath = path.join(showsDir, filename);

    // Verify original file exists
    try {
      await fs.access(oldFilePath);
    } catch (e) {
      return NextResponse.json({ success: false, error: 'Original show not found' }, { status: 404 });
    }

    // Read original show
    const existingData = await fs.readFile(oldFilePath, 'utf-8');
    const showData = JSON.parse(existingData);

    const sanitizeName = (name: string) => name.replace(/[\\/:*?"<>|]/g, ' ').trim();
    const cleanTitle = sanitizeName(newTitle);

    const newFilename = `${cleanTitle}.show`;
    const newFilePath = path.join(showsDir, newFilename);

    // Verify target file doesn't already exist to prevent overwrites
    try {
      await fs.access(newFilePath);
      return NextResponse.json({ success: false, error: 'A show with that name already exists' }, { status: 409 });
    } catch (e) {}

    // Generate new unique ID for the duplicate
    const newShowId = Math.random().toString(36).padEnd(15, '0').substring(2, 13);
    const showObj = showData[1];
    
    // Update name and reset modified timestamps
    showObj.name = cleanTitle;
    showObj.timestamps = showObj.timestamps || {};
    showObj.timestamps.created = Date.now();
    showObj.timestamps.modified = Date.now();

    const serialized = JSON.stringify([newShowId, showObj], null, 2);
    await fs.writeFile(newFilePath, serialized, 'utf-8');

    return NextResponse.json({ success: true, filename: newFilename, name: cleanTitle });

  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
