export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { readdirSync, statSync } from "fs";
import path from "path";
import { hasDesktopAccess, DESKTOP_COOKIE } from "@/lib/desktopAccess";

// The files of this build (/_next/static/...) that the desktop app keeps a copy of, so it can show the
// Tracks screen without a connection to the server. They are public files of the web app; only the desktop app asks.
function walk(dir: string, prefix: string, out: string[]) {
  for (const name of readdirSync(dir)) {
    if (name.startsWith("._")) continue;     // macOS metadata files on external disks: not part of the build
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, `${prefix}/${name}`, out);
    else if (!name.endsWith(".map")) out.push(`${prefix}/${name}`);
  }
}

export async function GET(req: NextRequest) {
  if (!hasDesktopAccess(req.headers.get("user-agent"), req.cookies.get(DESKTOP_COOKIE)?.value)) {
    return NextResponse.json({ error: "Alleen voor de desktop-app" }, { status: 403 });
  }
  const files: string[] = [];
  try { walk(path.join(process.cwd(), ".next", "static"), "/_next/static", files); } catch { /* dev server: no build */ }
  return NextResponse.json({ files });
}
