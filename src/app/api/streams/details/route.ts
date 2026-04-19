import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";

export async function GET(req: NextRequest) {
  const session: any = await auth();
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  const provider = searchParams.get("provider");

  if (!session || !id || !provider) {
    return NextResponse.json({ error: "Ongeldige aanvraag" }, { status: 400 });
  }

  try {
    if (provider === "youtube") {
      // 1. Get Broadcast details to find the bound Stream ID
      const broadcastRes = await fetch(`https://www.googleapis.com/youtube/v3/liveBroadcasts?part=contentDetails&id=${id}`, {
        headers: { Authorization: `Bearer ${session.youtubeToken}` }
      });
      const broadcastData = await broadcastRes.json();
      const streamId = broadcastData.items?.[0]?.contentDetails?.boundStreamId;

      if (!streamId) {
        return NextResponse.json({ error: "Geen gekoppelde stream gevonden voor deze YouTube broadcast" }, { status: 404 });
      }

      // 2. Get Stream details for the stream key
      const streamRes = await fetch(`https://www.googleapis.com/youtube/v3/liveStreams?part=cdn,status&id=${streamId}`, {
        headers: { Authorization: `Bearer ${session.youtubeToken}` }
      });
      const streamData = await streamRes.json();
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

    } else if (provider === "facebook") {
      // Get Facebook live video details including secure_stream_url
      const fbRes = await fetch(`https://graph.facebook.com/${id}?fields=id,status,secure_stream_url,stream_url&access_token=${session.facebookToken}`);
      const fbData = await fbRes.json();

      if (fbData.error) {
        throw new Error(fbData.error.message);
      }

      // Extract stream key from URL if needed, but OBS usually takes the full URL or Server+Key
      // Facebook secure_stream_url format: rtmps://rtmp-api.facebook.com:443/rtmp/[STREAM_KEY]
      const secureUrl = fbData.secure_stream_url || fbData.stream_url;
      let streamKey = "";
      let serverUrl = "";

      if (secureUrl) {
        const parts = secureUrl.split("/rtmp/");
        if (parts.length === 2) {
          serverUrl = parts[0] + "/rtmp/";
          streamKey = parts[1];
        }
      }

      return NextResponse.json({
        provider: "facebook",
        streamKey: streamKey,
        serverUrl: serverUrl,
        fullUrl: secureUrl,
        status: fbData.status
      });
    }

    return NextResponse.json({ error: "Onbekende provider" }, { status: 400 });
  } catch (error: any) {
    console.error("Error fetching stream details:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
