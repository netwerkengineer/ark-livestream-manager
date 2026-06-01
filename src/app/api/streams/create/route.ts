import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import fs from "fs";
import path from "path";

export async function POST(req: NextRequest) {
  const session: any = await auth();
  
  if (!session || !session.youtubeToken) {
    return NextResponse.json({ error: "Niet ingelogd bij YouTube" }, { status: 401 });
  }

  const { title, description, scheduleTime, thumbnailUrl, privacyStatus, categoryId, playlistId, tags } = await req.json();

  try {
    // 1. YouTube Integratie
    const streamsRes = await fetch("https://www.googleapis.com/youtube/v3/liveStreams?mine=true&part=id,cdn", {
      headers: { Authorization: `Bearer ${session.youtubeToken}` }
    });
    const streamsData = await streamsRes.json();
    
    if (streamsData.error) {
       throw new Error(`YouTube API Fout: ${streamsData.error.message}`);
    }

    const streamId = streamsData.items?.[0]?.id;

    if (!streamId) {
      throw new Error("Geen actieve stream key gevonden op YouTube.");
    }

    // Stap 1.2: Maak broadcast aan
    const broadcastRes = await fetch("https://www.googleapis.com/youtube/v3/liveBroadcasts?part=snippet,status,contentDetails", {
      method: "POST",
      headers: { 
        Authorization: `Bearer ${session.youtubeToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        snippet: {
          title: title,
          description: description,
          scheduledStartTime: scheduleTime,
          categoryId: categoryId || "29",
          tags: tags ? tags.split(",").map((t: string) => t.trim()) : []
        },
        status: {
          privacyStatus: privacyStatus || "public",
          selfDeclaredMadeForKids: false
        },
        contentDetails: {
          enableAutoStart: true,
          enableAutoStop: true
        }
      })
    });
    const broadcastData = await broadcastRes.json();
    
    if (broadcastData.error) {
      throw new Error(`YouTube Broadcast Fout: ${broadcastData.error.message}`);
    }

    const broadcastId = broadcastData.id;

    // Stap 1.3: Bind broadcast
    await fetch(`https://www.googleapis.com/youtube/v3/liveBroadcasts/bind?id=${broadcastId}&streamId=${streamId}&part=id`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.youtubeToken}` }
    });

    // Stap 1.3b: Voeg toe aan playlist indien opgegeven
    if (playlistId) {
      fetch("https://www.googleapis.com/youtube/v3/playlistItems?part=snippet", {
        method: "POST",
        headers: { 
          Authorization: `Bearer ${session.youtubeToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          snippet: {
            playlistId: playlistId,
            resourceId: {
              kind: "youtube#video",
              videoId: broadcastId
            }
          }
        })
      }).catch(err => console.error("YouTube Playlist Insert Fout:", err));
    }

    // Stap 1.4: Thumbnail & Lokale Opslag
    if (thumbnailUrl && thumbnailUrl.startsWith("data:image")) {
      const base64Data = thumbnailUrl.split(",")[1];
      const imageBuffer = Buffer.from(base64Data, 'base64');
      
      // Upload naar YouTube (Achtergrond, blokkeert de rest niet)
      fetch(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${broadcastId}&uploadType=media`, {
        method: "POST",
        headers: { 
          Authorization: `Bearer ${session.youtubeToken}`,
          "Content-Type": "image/png"
        },
        body: imageBuffer
      }).catch(err => console.error("YouTube Thumbnail Upload Fout:", err));

      // Sla lokaal op (Voor OBS op de NAS)
      try {
        const internalPath = "/app/public/thumbnails";
        if (!fs.existsSync(internalPath)) {
          fs.mkdirSync(internalPath, { recursive: true });
        }
        const filePath = path.join(internalPath, "thema.jpg");
        fs.writeFileSync(filePath, imageBuffer);
        console.log(`Thumbnail succesvol opgeslagen op NAS: ${filePath}`);
      } catch (err) {
        console.error("Lokaal opslaan thumbnail mislukt:", err);
      }
    }

    return NextResponse.json({ success: true });

  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
