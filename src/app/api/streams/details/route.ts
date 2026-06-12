import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/authHelper";
import { youtubeFetch } from "@/lib/tokenStore";

export async function GET(req: NextRequest) {
  const authSession = await isAuthorized(req, undefined, "planner");
  if (!authSession) {
    return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  const provider = searchParams.get("provider");

  if (!id || !provider) {
    return NextResponse.json({ error: "Ongeldige aanvraag" }, { status: 400 });
  }

  try {
    if (provider === "youtube") {
      // 1. Get Broadcast details to find the bound Stream ID
      const broadcastRes = await youtubeFetch(`https://www.googleapis.com/youtube/v3/liveBroadcasts?part=contentDetails&id=${id}`);
      const broadcastData = await broadcastRes.json();
      
      if (broadcastData.error) {
        throw new Error(`YouTube API Fout: ${broadcastData.error.message}`);
      }
      
      const streamId = broadcastData.items?.[0]?.contentDetails?.boundStreamId;

      if (!streamId) {
        return NextResponse.json({ error: "Geen gekoppelde stream gevonden voor deze YouTube broadcast" }, { status: 404 });
      }

      // 2. Get Stream details for the stream key
      const streamRes = await youtubeFetch(`https://www.googleapis.com/youtube/v3/liveStreams?part=cdn,status&id=${streamId}`);
      const streamData = await streamRes.json();
      
      if (streamData.error) {
        throw new Error(`YouTube Stream API Fout: ${streamData.error.message}`);
      }
      
      const streamItem = streamData.items?.[0];

      if (!streamItem) {
        return NextResponse.json({ error: "Stream details niet gevonden" }, { status: 404 });
      }

      return NextResponse.json({
        provider: "youtube",
        streamKey: streamItem.cdn?.ingestionInfo?.streamName,
        serverUrl: streamItem.cdn?.ingestionInfo?.ingestionAddress,
        health: streamItem.status?.healthStatus?.status,
        healthDescription: streamItem.status?.healthStatus?.lastError
      });
    }

    return NextResponse.json({ error: "Onbekende provider" }, { status: 400 });
  } catch (error: any) {
    console.error("Error fetching stream details:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
