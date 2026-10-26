import { NextResponse } from "next/server";
import { getSettings } from "@/lib/settingsStore";

export const dynamic = "force-dynamic";

// Deliberately unauthenticated (like /api/public/live-status): the lyrics-roll page (public/lyrics-roll.html) runs inside a
// FreeShow web item on the beamer computer, which has no login. It only returns the text of the slide that is on screen anyway.
// The browser can't ask FreeShow's REST API itself (no CORS headers), so this route does it, with the FreeShow address that is already
// in the settings (Instellingen -> Verbindingen: FreeShow IP and port, the same API port FreeShow listens on).
const TTL_MS = 150;
const NO_STORE = { "Cache-Control": "no-store" };
let cache: { at: number; text: string } | null = null;

// Slides of the roll arrangements (web items of this page) carry no text items (a FreeShow template would show them in the hall too), so FreeShow's own
// "text of the slide on screen" is empty for them. Their text is kept in the slide notes: look the slide up through the output state
// (show, layout, index) and the show itself, which is cached because it is large.
type ShowData = {
  layouts?: Record<string, { slides?: { id: string }[] }>;
  slides?: Record<string, { notes?: string; items?: { type?: string; web?: { src?: string } }[] }>;
};
const showCache = new Map<string, { at: number; show: ShowData }>();
const SHOW_TTL_MS = 30000;

async function freeshow(base: string, action: string, extra: Record<string, unknown> = {}) {
  const res = await fetch(base, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, ...extra }),
    signal: AbortSignal.timeout(2000),
  });
  return (await res.json())?.data;
}

async function textFromNotes(base: string): Promise<string> {
  const slide = (await freeshow(base, "get_output"))?.slide as { id?: string; layout?: string; index?: number } | undefined;
  if (!slide?.id || !slide.layout || typeof slide.index !== "number") return "";
  let entry = showCache.get(slide.id);
  if (!entry || Date.now() - entry.at > SHOW_TTL_MS) {
    const show = (await freeshow(base, "get_show", { id: slide.id })) as ShowData | undefined;
    if (!show) return "";
    entry = { at: Date.now(), show };
    showCache.set(slide.id, entry);
  }
  const ref = entry.show.layouts?.[slide.layout]?.slides?.[slide.index];
  const found = ref ? entry.show.slides?.[ref.id] : undefined;
  // only slides of the roll arrangements (they hold a web item of this page); the notes of any other slide are operator hints, not lyrics
  if (!found?.items?.some((item) => item.type === "web" && String(item.web?.src || "").includes("lyrics-roll"))) return "";
  return typeof found.notes === "string" ? found.notes : "";
}

export async function GET() {
  if (cache && Date.now() - cache.at < TTL_MS) return NextResponse.json({ text: cache.text }, { headers: NO_STORE });

  const { freeShowHost, freeShowPort } = getSettings();
  const host = String(freeShowHost || "").trim();
  if (!host) return NextResponse.json({ text: "", error: "FreeShow IP is niet ingesteld (Instellingen, Verbindingen)" }, { status: 503, headers: NO_STORE });
  const base = `http://${host}:${freeShowPort || 5505}`;

  try {
    let text = await freeshow(base, "get_output_slide_text");
    text = typeof text === "string" ? text : "";
    if (!text) text = await textFromNotes(base);
    cache = { at: Date.now(), text };
    return NextResponse.json({ text }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ text: "", error: "FreeShow niet bereikbaar" }, { status: 502, headers: NO_STORE });
  }
}
