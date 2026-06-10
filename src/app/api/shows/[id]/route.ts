import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { isAuthorized } from '@/lib/authHelper';
import { getSettings } from '@/lib/settingsStore';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

    const { id } = await params;
    const decodedId = decodeURIComponent(id);
    const filename = decodedId.toLowerCase().endsWith('.show') ? decodedId : `${decodedId}.show`;
    const filePath = path.join(freeshowPath, 'Shows', filename);

    try {
      const data = await fs.readFile(filePath, 'utf-8');
      const showObj = JSON.parse(data);
      return NextResponse.json({ success: true, show: showObj });
    } catch (err: any) {
      return NextResponse.json({ success: false, error: `Show not found: ${err.message}` }, { status: 404 });
    }
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

    const { id } = await params;
    const decodedId = decodeURIComponent(id);
    const oldFilename = decodedId.toLowerCase().endsWith('.show') ? decodedId : `${decodedId}.show`;
    const oldFilePath = path.join(freeshowPath, 'Shows', oldFilename);

    const body = await request.json();
    
    // Support 1: Raw JSON saving
    if (body.rawJson) {
      let parsedArray;
      try {
        parsedArray = JSON.parse(body.rawJson);
        if (!Array.isArray(parsedArray) || parsedArray.length < 2) {
          throw new Error('Show format must be a JSON array of [id, showDetails]');
        }
      } catch (err: any) {
        return NextResponse.json({ success: false, error: `Invalid JSON format: ${err.message}` }, { status: 400 });
      }

      const showObj = parsedArray[1];
      const newTitle = showObj.name;
      const sanitizeName = (name: string) => name.replace(/[\\/:*?"<>|]/g, ' ').trim();
      const cleanTitle = sanitizeName(newTitle);
      
      const newFilename = `${cleanTitle}.show`;
      const newFilePath = path.join(freeshowPath, 'Shows', newFilename);

      const serialized = JSON.stringify(parsedArray, null, 2);
      await fs.writeFile(newFilePath, serialized, 'utf-8');

      if (newFilename !== oldFilename) {
        try {
          await fs.unlink(oldFilePath);
        } catch (e) {}
      }

      return NextResponse.json({ success: true, filename: newFilename, show: parsedArray });
    }

    // Support 2: Visual edits (meta & slide text modifications)
    const { title, category, slides } = body;
    if (!title) {
      return NextResponse.json({ success: false, error: 'Title is required' }, { status: 400 });
    }

    let showData;
    try {
      const existingData = await fs.readFile(oldFilePath, 'utf-8');
      showData = JSON.parse(existingData);
    } catch (err: any) {
      return NextResponse.json({ success: false, error: `Original show not found: ${err.message}` }, { status: 404 });
    }

    const showId = showData[0];
    const showObj = showData[1];

    const sanitizeName = (name: string) => name.replace(/[\\/:*?"<>|]/g, ' ').trim();
    const cleanTitle = sanitizeName(title);
    showObj.name = cleanTitle;
    showObj.category = category || showObj.category || 'song';
    showObj.timestamps = showObj.timestamps || {};
    showObj.timestamps.modified = Date.now();

    if (slides && showObj.slides) {
      for (const [slideId, newText] of Object.entries(slides)) {
        const slide = showObj.slides[slideId];
        if (slide && slide.items && slide.items[0]) {
          const item = slide.items[0];
          if (item.type === 'text') {
            const existingStyle = item.lines?.[0]?.text?.[0]?.style || "font-size: 100px;";
            item.lines = (newText as string).split('\n').map(lineStr => ({
              align: item.lines?.[0]?.align || "",
              text: [{ value: lineStr, style: existingStyle }]
            }));
          }
        }
      }
    }

    const newFilename = `${cleanTitle}.show`;
    const newFilePath = path.join(freeshowPath, 'Shows', newFilename);
    const serialized = JSON.stringify([showId, showObj], null, 2);

    await fs.writeFile(newFilePath, serialized, 'utf-8');

    if (newFilename !== oldFilename) {
      try {
        await fs.unlink(oldFilePath);
      } catch (e) {}
    }

    return NextResponse.json({ success: true, filename: newFilename, show: [showId, showObj] });

  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authSession = await isAuthorized(request);
    if (!authSession) {
      return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
    }

    const settings = getSettings() as any;
    const freeshowPath = settings.freeshowPath || '';
    const trashDir = settings.freeshowTrashPath || '';
    if (!freeshowPath) {
      return NextResponse.json({ success: false, error: 'FreeShow path not configured' }, { status: 400 });
    }

    const { id } = await params;
    const decodedId = decodeURIComponent(id);
    const filename = decodedId.toLowerCase().endsWith('.show') ? decodedId : `${decodedId}.show`;
    const filePath = path.join(freeshowPath, 'Shows', filename);

    try {
      await fs.access(filePath);
    } catch (e) {
      return NextResponse.json({ success: false, error: 'Show file not found' }, { status: 404 });
    }

    const backupDir = trashDir || path.join(freeshowPath, '.trash');
    const backupPath = path.join(backupDir, `${Date.now()}_${filename}`);

    await fs.mkdir(backupDir, { recursive: true });

    const content = await fs.readFile(filePath);
    await fs.writeFile(backupPath, content);

    await fs.unlink(filePath);

    return NextResponse.json({ success: true, message: 'Show successfully moved to trash.' });

  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
