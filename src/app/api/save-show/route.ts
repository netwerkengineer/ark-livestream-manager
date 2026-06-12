import { NextRequest, NextResponse } from 'next/server';
import { createShowObject } from '@/lib/freeshow';
import { isAuthorized } from '@/lib/authHelper';
import { getSettings } from '@/lib/settingsStore';
import fs from 'fs';
import path from 'path';

export async function POST(req: NextRequest) {
  try {
    const authSession = await isAuthorized(req, undefined, "freeshow");
    if (!authSession) {
      return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
    }

    const { item, saveToNas } = await req.json();
    const settings = getSettings() as any;
    const freeshowPath = settings.freeshowPath || '';
    
    // Alphanumeric ID
    const generateId = () => Math.random().toString(36).substring(2, 13);
    const showId = item.fullData?.id || generateId();

    let showInput: any = {};
    if (item.type === 'song') {
      showInput = {
        id: showId,
        fullData: item.fullData,
        data: {
          name: `${item.title}${item.artist ? ' - ' + item.artist : ''}`,
          category: "song",
          text: item.text
        }
      };
    } else if (item.type === 'bible') {
      showInput = {
        id: showId,
        refData: item.bibleData,
        data: {
          name: `${item.ref} - ${item.translation}`,
          category: "scripture",
          text: item.text
        }
      };
    }

    const sanitizeName = (name: string) => name.replace(/[\\/:*?"<>|]/g, ' ').trim();
    const cleanName = sanitizeName(showInput.data.name);
    showInput.data.name = cleanName;

    // Use existing data if available to preserve formatting, media, etc.
    let showObj: any;
    if (item.fullData && item.fullData.data) {
      showObj = item.fullData.data;
      showObj.name = cleanName; // Ensure name is sanitized
    } else {
      showObj = createShowObject(showInput);
    }

    const fileName = `${cleanName}.show`;
    const serialized = JSON.stringify([showId, showObj]);
    
    console.log("Saving show:", fileName);

    if (saveToNas && freeshowPath) {
      const showsDir = path.join(freeshowPath, 'Shows');
      
      if (!fs.existsSync(showsDir)) {
        fs.mkdirSync(showsDir, { recursive: true });
      }

      const filePath = path.join(showsDir, fileName);
      fs.writeFileSync(filePath, serialized);
      
      return NextResponse.json({ success: true, message: `Saved in ${filePath}`, data: showObj });
    }

    // Default: return for download
    return new NextResponse(serialized as any, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${fileName}"`
      }
    });

  } catch (error: any) {
    console.error("Save show error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
