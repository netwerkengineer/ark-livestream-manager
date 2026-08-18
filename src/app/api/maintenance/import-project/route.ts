import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized } from "@/lib/authHelper";
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const authSession = await isAuthorized(req, undefined, 'freeshow');
  if (!authSession) {
    return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
  }

  const scriptCandidates = [
    path.join(process.cwd(), 'import_project.py'),
    '/app/import_project.py'
  ];

  let scriptPath = '';
  for (const candidate of scriptCandidates) {
    if (fs.existsSync(candidate)) {
      scriptPath = candidate;
      break;
    }
  }

  if (!scriptPath) {
    return NextResponse.json({ error: 'import_project.py niet gevonden' }, { status: 500 });
  }

  try {
    const dataDir = path.join(path.dirname(scriptPath), 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    const logPath = path.join(dataDir, 'import_project.log');
    fs.appendFileSync(logPath, `\n--- MANUAL PROJECT IMPORT TRIGGERED AT ${new Date().toISOString()} ---\n`);

    const logStream = fs.createWriteStream(logPath, { flags: 'a' });
    const child = spawn('python3', [scriptPath], {
      detached: true,
      stdio: ['ignore', logStream, logStream]
    });
    child.unref();

    return NextResponse.json({ success: true, message: 'Laatste project wordt naar FreeShow gestuurd op de achtergrond' });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Onbekende fout' }, { status: 500 });
  }
}
