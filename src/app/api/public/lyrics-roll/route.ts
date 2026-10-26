import { NextRequest, NextResponse } from "next/server";
import { getSettings } from "@/lib/settingsStore";

export const dynamic = "force-dynamic";

// Deliberately unauthenticated (like /api/public/live-status): the lyrics-roll page (public/lyrics-roll.html) runs inside FreeShow web items
// on the beamer computer, which has no login. It only returns the text of the slide that is on screen anyway.
// The browser can't ask FreeShow's REST API itself (no CORS headers), so this route does it, with the FreeShow address that is already
// in the settings (Instellingen -> Verbindingen: FreeShow IP and port, the same API port FreeShow listens on).
//
// One shared poller asks FreeShow what is on the output (every ~100 ms, only while some page is asking); pages long-poll this route with the
// version they have and get the answer the moment it changes. So the number of open pages (FreeShow draws one per slide thumbnail) does not
// multiply the load on FreeShow, and a slide change reaches the page within ~100-150 ms.
//
// Slides of the roll arrangements carry no items at all (a FreeShow template would show them in the hall too), so their
// text lives in the slide notes (the page itself comes from two overlays that the start slide switches on): it is looked up through the output state (show, layout, index) and the show itself, which is cached because it is large.
const NO_STORE = { "Cache-Control": "no-store" };
const POLL_MS = 100;
const SHOW_TTL_MS = 30000;
const IDLE_STOP_MS = 15000;
const LONGPOLL_MS = 8000;

type ShowData = {
  layouts?: Record<string, { notes?: string; slides?: { id: string }[] }>;
  slides?: Record<string, { notes?: string }>;
};
const MARKER = "ark-doorrol"; // in the notes of a roll arrangement (scripts/visuals/make_dynamische_song.py)
type Out = { id?: string; layout?: string; index?: number };

const state = { key: "", text: "", v: 0, at: 0, error: "" };
const showCache = new Map<string, { at: number; show: ShowData }>();
let lastDemand = 0;
let looping: Promise<void> | null = null;
const sizes: { t: string; w: string }[] = [];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function baseUrl(): string {
  const { freeShowHost, freeShowPort } = getSettings();
  const host = String(freeShowHost || "").trim();
  return host ? `http://${host}:${freeShowPort || 5505}` : "";
}

async function freeshow(base: string, action: string, extra: Record<string, unknown> = {}) {
  const res = await fetch(base, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, ...extra }),
    signal: AbortSignal.timeout(2000),
  });
  return (await res.json())?.data;
}

async function textFor(base: string, slide: Out): Promise<string> {
  if (!slide.id || !slide.layout || typeof slide.index !== "number") return "";
  let entry = showCache.get(slide.id);
  if (!entry || Date.now() - entry.at > SHOW_TTL_MS) {
    const show = (await freeshow(base, "get_show", { id: slide.id })) as ShowData | undefined;
    if (show) {
      entry = { at: Date.now(), show };
      showCache.set(slide.id, entry);
    }
  }
  const layout = entry?.show.layouts?.[slide.layout];
  // only slides of a roll arrangement; every other slide (and the notes on it, which are operator hints) shows nothing here
  if (layout?.notes !== MARKER) return "";
  if (slide.index === 0) return ""; // the start slide keeps its operator hint in the notes
  const ref = layout.slides?.[slide.index];
  const notes = ref ? entry?.show.slides?.[ref.id]?.notes : "";
  return typeof notes === "string" ? notes : "";
}

async function refresh(base: string) {
  try {
    const slide = ((await freeshow(base, "get_output"))?.slide || null) as Out | null;
    const key = slide ? `${slide.id}|${slide.layout}|${slide.index}` : "";
    if (key !== state.key || state.error) {
      const text = slide ? await textFor(base, slide) : "";
      if (text !== state.text || key !== state.key) state.v++;
      state.key = key;
      state.text = text;
    }
    state.error = "";
  } catch {
    state.error = "FreeShow niet bereikbaar";
  }
  state.at = Date.now();
}

function ensureLoop() {
  lastDemand = Date.now();
  if (looping) return;
  looping = (async () => {
    try {
      while (Date.now() - lastDemand < IDLE_STOP_MS) {
        const base = baseUrl();
        if (base) await refresh(base);
        await sleep(POLL_MS);
      }
    } finally {
      looping = null;
    }
  })();
}

export async function GET(req: NextRequest) {
  const log = req.nextUrl.searchParams.get("log");
  if (log === "read") return NextResponse.json({ sizes }, { headers: NO_STORE });
  if (log) {
    sizes.push({ t: new Date().toISOString(), w: log.slice(0, 80) });
    if (sizes.length > 40) sizes.shift();
    return new NextResponse(null, { status: 204 });
  }

  if (!baseUrl()) return NextResponse.json({ text: "", error: "FreeShow IP is niet ingesteld (Instellingen, Verbindingen)" }, { status: 503, headers: NO_STORE });

  const wasIdle = !looping;
  ensureLoop();
  if (wasIdle || Date.now() - state.at > 2000) await refresh(baseUrl());

  const clientV = Number(req.nextUrl.searchParams.get("v"));
  if (Number.isFinite(clientV) && clientV >= 0 && clientV === state.v) {
    const until = Date.now() + LONGPOLL_MS;
    while (state.v === clientV && Date.now() < until && !req.signal.aborted) await sleep(40);
  }
  return NextResponse.json({ text: state.text, v: state.v, ...(state.error ? { error: state.error } : {}) }, { headers: NO_STORE });
}
