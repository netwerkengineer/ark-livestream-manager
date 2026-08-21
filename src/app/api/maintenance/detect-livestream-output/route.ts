import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized } from '@/lib/authHelper';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';

const execFilePromise = promisify(execFile);
export const dynamic = 'force-dynamic';

// One-shot lookup, not a background job: connects to whichever machine
// currently runs FreeShow for this environment and reads its local
// settings.json for the output name-to-ID mapping - that ID never shows up
// in FreeShow's own UI, and doesn't change once an output exists, so this
// only needs running once per environment (or again if an output ever gets
// deleted/recreated).
export async function POST(req: NextRequest) {
  const authSession = await isAuthorized(req, undefined, 'freeshow');
  if (!authSession) {
    return NextResponse.json({ error: 'Niet geautoriseerd' }, { status: 401 });
  }

  const scriptCandidates = [
    path.join(process.cwd(), 'detect_freeshow_outputs.py'),
    '/app/detect_freeshow_outputs.py'
  ];
  const scriptPath = scriptCandidates.find(p => fs.existsSync(p));
  if (!scriptPath) {
    return NextResponse.json({ error: 'detect_freeshow_outputs.py niet gevonden' }, { status: 500 });
  }

  try {
    const { stdout } = await execFilePromise('python3', [scriptPath], { timeout: 15000 });
    const lastLine = stdout.trim().split('\n').pop() || '{}';
    const result = JSON.parse(lastLine);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 502 });
    }
    return NextResponse.json({ success: true, host: result.host, outputs: result.outputs || [] });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Onbekende fout bij opzoeken outputs' }, { status: 500 });
  }
}
