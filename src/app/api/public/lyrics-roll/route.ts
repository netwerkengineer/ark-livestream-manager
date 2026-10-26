import { NextResponse } from "next/server";
import { getSettings } from "@/lib/settingsStore";

export const dynamic = "force-dynamic";

// Deliberately unauthenticated (like /api/public/live-status): the lyrics-roll page (public/lyrics-roll.html) runs inside a
// FreeShow web item on the beamer computer, which has no login. It only returns the text of the slide that is on screen anyway.
// The browser can't ask FreeShow's REST API itself (no CORS headers), so this route does it, with the address from the settings.
const TTL_MS = 150;
const NO_STORE = { "Cache-Control": "no-store" };
let cache: { at: number; text: string } | null = null;

export async function GET() {
  if (cache && Date.now() - cache.at < TTL_MS) return NextResponse.json({ text: cache.text }, { headers: NO_STORE });

  const { freeshowApiUrl, freeshowApiPassword } = getSettings();
  const base = String(freeshowApiUrl || "").trim();
  if (!base) return NextResponse.json({ text: "", error: "freeshowApiUrl is niet ingesteld" }, { status: 503, headers: NO_STORE });

  try {
    const res = await fetch(base, {
      method: "POST",
      headers: { "content-type": "application/json", ...(freeshowApiPassword ? { authorization: `Bearer ${freeshowApiPassword}` } : {}) },
      body: JSON.stringify({ action: "get_output_slide_text", ...(freeshowApiPassword ? { password: freeshowApiPassword } : {}) }),
      signal: AbortSignal.timeout(2000),
    });
    const j = await res.json();
    const text = typeof j?.data === "string" ? j.data : "";
    cache = { at: Date.now(), text };
    return NextResponse.json({ text }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ text: "", error: "FreeShow niet bereikbaar" }, { status: 502, headers: NO_STORE });
  }
}
