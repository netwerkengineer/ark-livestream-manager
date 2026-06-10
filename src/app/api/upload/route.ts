import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { isAuthorized } from '@/lib/authHelper';

export async function POST(req: NextRequest) {
  try {
    const authSession = await isAuthorized(req);
    if (!authSession) {
      return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
    }
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const directory = formData.get('directory') as string | null;

    if (!file || !directory) {
      return NextResponse.json({ success: false, error: "Missing file or directory" }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Create directory if it doesn't exist
    await mkdir(directory, { recursive: true });

    // Sanitize filename to prevent directory traversal
    const safeFilename = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    const filePath = join(directory, safeFilename);

    await writeFile(filePath, buffer);

    return NextResponse.json({ 
      success: true, 
      filePath: filePath,
      message: "Uploaded successfully"
    });

  } catch (error: any) {
    console.error("Upload error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
