import { NextResponse } from "next/server";
import { youtubeFetch } from "@/lib/tokenStore";

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

export async function GET() {
  if (cache && Date.now() - cache.timestamp < CACHE_TTL_MS) {
    return NextResponse.json(cache.data);
  }

  const respond = (data: LiveStatus) => {
    cache = { data, timestamp: Date.now() };
    return NextResponse.json(data);
  };

  try {
    const activeRes = await youtubeFetch(
      "https://www.googleapis.com/youtube/v3/liveBroadcasts?part=snippet,status&broadcastStatus=active&broadcastType=all",
      { cache: "no-store" }
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
