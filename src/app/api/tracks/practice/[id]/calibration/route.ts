export const dynamic = "force-dynamic";

import fs from "fs/promises";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { isPracticeAuthorized } from "@/lib/practiceAuth";
import { practiceDir } from "@/lib/trackPractice";

// A click at exactly 0.5 s, encoded like the segments: the player measures
// the AAC decoder delay of its browser on it.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isPracticeAuthorized(req))) {
    return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
  }
  const { id } = await params;
  try {
    const data = await fs.readFile(path.join(practiceDir(id), "calibration.m4a"));
    return new NextResponse(new Uint8Array(data), {
      headers: { "Content-Type": "audio/mp4", "Cache-Control": "private, max-age=31536000, immutable" },
    });
  } catch {
    return NextResponse.json({ error: "Niet gevonden" }, { status: 404 });
  }
}
