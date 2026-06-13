import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

export async function GET() {
  try {
    const progressPath = path.join(process.cwd(), 'data', 'backup_progress.json');
    const content = await fs.readFile(progressPath, 'utf8');
    return NextResponse.json(JSON.parse(content));
  } catch (err: any) {
    // If the file doesn't exist, we assume idle or not started yet
    if (err.code === 'ENOENT') {
      return NextResponse.json({ status: 'idle', percent: 0 });
    }
    return NextResponse.json({ status: 'error', error: err.message }, { status: 500 });
  }
}
