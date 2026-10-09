export const dynamic = "force-dynamic";

import fs from "fs";
import { Readable } from "stream";
import { NextRequest, NextResponse } from "next/server";
import { desktopGuard } from "@/lib/trackDesktop";
import { getTrack, trackFilePath } from "@/lib/trackLibrary";

// Download of the zip of one song for the desktop app, with Range support so an interrupted download resumes
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await desktopGuard(req);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });
  const { id } = await params;
  const item = getTrack(id);
  if (!item || item.status === "uploading" || item.status === "deleted" || item.status === "error") {
    return NextResponse.json({ error: "Track niet gevonden" }, { status: 404 });
  }
  const file = trackFilePath(id);
  const size = fs.statSync(file).size;
  const range = req.headers.get("range")?.match(/^bytes=(\d+)-$/);
  const start = range ? parseInt(range[1]) : 0;
  if (start >= size && size > 0) {
    return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  }
  const stream = Readable.toWeb(fs.createReadStream(file, { start })) as ReadableStream;
  const headers: Record<string, string> = { "Content-Type": "application/zip", "Content-Length": String(size - start), "Accept-Ranges": "bytes" };
  if (range) headers["Content-Range"] = `bytes ${start}-${size - 1}/${size}`;
  return new NextResponse(stream, { status: range ? 206 : 200, headers });
}
