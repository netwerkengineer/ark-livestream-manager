import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/authHelper";
import { youtubeFetch } from "@/lib/tokenStore";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const authSession = await isAuthorized(req);
  if (!authSession) {
    return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const queryVideoId = searchParams.get("videoId");

  try {
    let broadcastId: string | null = queryVideoId;
    let broadcastTitle = "";
    let lifeCycleStatus = "offline";

    if (!broadcastId) {
      // 1. Fetch active live broadcasts on YouTube
      const activeRes = await youtubeFetch(
        "https://www.googleapis.com/youtube/v3/liveBroadcasts?part=snippet,status&broadcastStatus=active&broadcastType=all",
        { cache: "no-store" }
      );

      if (activeRes.status === 401) {
        return NextResponse.json({ error: "YouTube verbinding verlopen. Koppel opnieuw." }, { status: 401 });
      }

      const activeData = await activeRes.json();
      if (activeData.items && activeData.items.length > 0) {
        const item = activeData.items[0];
        broadcastId = item.id;
        broadcastTitle = item.snippet.title;
        lifeCycleStatus = item.status.lifeCycleStatus; // usually 'live'
      } else {
        // Fallback: Fetch upcoming scheduled broadcasts
        const upcomingRes = await youtubeFetch(
          "https://www.googleapis.com/youtube/v3/liveBroadcasts?part=snippet,status&broadcastStatus=upcoming&broadcastType=all",
          { cache: "no-store" }
        );
        const upcomingData = await upcomingRes.json();
        if (upcomingData.items && upcomingData.items.length > 0) {
          // Sort by closest absolute time to now to ignore orphaned test streams from years ago
          const nowTime = Date.now();
          const upcoming = upcomingData.items.sort(
            (a: any, b: any) =>
              Math.abs(new Date(a.snippet.scheduledStartTime).getTime() - nowTime) -
              Math.abs(new Date(b.snippet.scheduledStartTime).getTime() - nowTime)
          );
          const item = upcoming[0];
          broadcastId = item.id;
          broadcastTitle = item.snippet.title;
          lifeCycleStatus = item.status.lifeCycleStatus; // usually 'ready'
        } else {
          // Fallback 2: Fetch any recent broadcast
          const anyRes = await youtubeFetch(
            "https://www.googleapis.com/youtube/v3/liveBroadcasts?part=snippet,status&mine=true&maxResults=1",
            { cache: "no-store" }
          );
          const anyData = await anyRes.json();
          if (anyData.items && anyData.items.length > 0) {
            const item = anyData.items[0];
            broadcastId = item.id;
            broadcastTitle = item.snippet.title;
            lifeCycleStatus = item.status.lifeCycleStatus;
          }
        }
      }
    }

    if (!broadcastId) {
      return NextResponse.json({
        active: false,
        broadcastStatus: "offline",
        title: "",
        concurrentViewers: 0,
        likeCount: 0,
        viewCount: 0,
        videoId: ""
      });
    }

    // 2. Query videos API to get liveStreamingDetails & statistics (viewers, likes, views)
    const videoRes = await youtubeFetch(
      `https://www.googleapis.com/youtube/v3/videos?part=snippet,liveStreamingDetails,statistics,status&id=${broadcastId}`,
      { cache: "no-store" }
    );
    const videoData = await videoRes.json();

    if (videoData.items && videoData.items.length > 0) {
      const videoItem = videoData.items[0];
      const liveDetails = videoItem.liveStreamingDetails;
      const stats = videoItem.statistics;
      
      const concurrentViewers = liveDetails?.concurrentViewers 
        ? parseInt(liveDetails.concurrentViewers) 
        : 0;
      const likeCount = stats?.likeCount ? parseInt(stats.likeCount) : 0;
      const viewCount = stats?.viewCount ? parseInt(stats.viewCount) : 0;
      const liveContent = videoItem.snippet?.liveBroadcastContent; // 'live', 'upcoming', 'none'

      return NextResponse.json({
        active: liveContent === "live",
        broadcastStatus: liveContent, // 'live', 'upcoming', or 'none'
        title: videoItem.snippet?.title || broadcastTitle,
        concurrentViewers,
        likeCount,
        viewCount,
        videoId: broadcastId
      });
    }

    return NextResponse.json({
      active: false,
      broadcastStatus: lifeCycleStatus === "live" ? "live" : "offline",
      title: broadcastTitle,
      concurrentViewers: 0,
      likeCount: 0,
      viewCount: 0,
      videoId: broadcastId
    });
  } catch (error: any) {
    console.error("[YouTube Stats API] Error fetching stats:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
