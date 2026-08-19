import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const statusPath = path.join(process.cwd(), 'data', 'sync_status.json');
    const content = await fs.readFile(statusPath, 'utf8');
    return NextResponse.json(JSON.parse(content));
  } catch (err: any) {
    // No sync has ever run yet on this environment
    if (err.code === 'ENOENT') {
      return NextResponse.json({ running: false });
    }
    return NextResponse.json({ running: false, error: err.message }, { status: 500 });
  }
}
