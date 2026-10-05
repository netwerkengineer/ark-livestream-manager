import { NextResponse } from "next/server";
import { youtubeFetch } from "@/lib/tokenStore";
import { getSettings } from "@/lib/settingsStore";
import { isWithinSundayServiceWindow } from "@/lib/serviceWindow";

export const dynamic = "force-dynamic";

// Deliberately unauthenticated (like /api/auth/sso-status) - the public
// ArkChurch website (a separate PHP site) polls this to show a "we are
// live now" banner, without needing its own YouTube API key or login.
// Only ever returns whether there's a currently-active broadcast and its
// watch URL/title - nothing sensitive.
const CACHE_TTL_MS = 20000;
let cache: { data: LiveStatus; timestamp: number } | null = null;

type LiveStatus = {
  live: boolean;
  url: string | null;
  title: string | null;
};

const NOT_LIVE: LiveStatus = { live: false, url: null, title: null };

export async function GET() {
  if (cache && Date.now() - cache.timestamp < CACHE_TTL_MS) {
    return NextResponse.json(cache.data);
  }

  const respond = (data: LiveStatus) => {
    cache = { data, timestamp: Date.now() };
    return NextResponse.json(data);
  };

  // The website's own PHP-side cache already limits this to at most one
  // call every 30s, but that's still ~2,880 YouTube calls/day if left
  // running around the clock - on the vast majority of days there's never
  // a stream to find. Skip the YouTube call entirely outside the same
  // Sunday service window the LED panel uses (Instellingen -> Verbindingen).
  if (!isWithinSundayServiceWindow(getSettings())) {
    return respond(NOT_LIVE);
  }

  try {
    const activeRes = await youtubeFetch(
      "https://www.googleapis.com/youtube/v3/liveBroadcasts?part=snippet,status&broadcastStatus=active&broadcastType=all",
      { cache: "no-store" },
      "website-banner"
    );

    if (!activeRes.ok) {
      return respond({ live: false, url: null, title: null });
    }

    const activeData = await activeRes.json();
    const item = activeData.items?.[0];
    if (!item) {
      return respond({ live: false, url: null, title: null });
    }

    return respond({
      live: true,
      url: `https://www.youtube.com/watch?v=${item.id}`,
      title: item.snippet?.title || null,
    });
  } catch (error) {
    console.error("[Public Live Status] Error checking YouTube live status:", error);
    return respond({ live: false, url: null, title: null });
  }
}
