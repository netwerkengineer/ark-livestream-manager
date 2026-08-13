import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { getSettings } from '@/lib/settingsStore';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path: pathSegments } = await params;
    const settings = getSettings() as any;
    const freeshowMediaPath = settings.freeshowMediaPath || '';

    if (!freeshowMediaPath) {
      return NextResponse.json(
        { error: 'FreeShow media path not configured' },
        { status: 500 }
      );
    }

    // Join path segments
    const relativePath = pathSegments.join('/');
    const fullPath = path.join(freeshowMediaPath, relativePath);

    // Security: ensure path is within media directory
    const resolvedPath = path.resolve(fullPath);
    const resolvedMediaPath = path.resolve(freeshowMediaPath);
    if (!resolvedPath.startsWith(resolvedMediaPath)) {
      return NextResponse.json(
        { error: 'Invalid path' },
        { status: 403 }
      );
    }

    // Read file
    const fileBuffer = await fs.readFile(resolvedPath);

    // Determine content type based on file extension
    const ext = path.extname(resolvedPath).toLowerCase();
    const contentTypeMap: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
      '.mov': 'video/quicktime'
    };

    const contentType = contentTypeMap[ext] || 'application/octet-stream';

    return new NextResponse(fileBuffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable'
      }
    });
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return NextResponse.json(
        { error: 'File not found' },
        { status: 404 }
      );
    }

    console.error('Error serving FreeShow media:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
