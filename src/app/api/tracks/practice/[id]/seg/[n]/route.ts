export const dynamic = "force-dynamic";

import fs from "fs/promises";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { isPracticeAuthorized } from "@/lib/practiceAuth";
import { practiceDir } from "@/lib/trackPractice";

// One time slice (all stems) of a practice version. The URL carries the
// version, so the browser keeps it: playing a song again costs nothing.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; n: string }> }) {
  if (!(await isPracticeAuthorized(req))) {
    return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
  }
  const { id, n } = await params;
  if (!/^\d{1,4}$/.test(n)) return NextResponse.json({ error: "Ongeldig stuk" }, { status: 400 });
  try {
    const data = await fs.readFile(path.join(practiceDir(id), "seg", `${Number(n)}.bin`));
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch {
    return NextResponse.json({ error: "Niet gevonden" }, { status: 404 });
  }
}
