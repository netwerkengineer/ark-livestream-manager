import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import fs from "fs";
import path from "path";

export async function POST(req: NextRequest) {
  const session: any = await auth();
  
  if (!session || (!session.youtubeToken && !session.facebookToken)) {
    return NextResponse.json({ error: "Niet ingelogd bij YouTube of Facebook" }, { status: 401 });
  }

  const { title, description, scheduleTime, thumbnailUrl, privacyStatus, facebookPageId, categoryId, playlistId, tags } = await req.json();

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

    // 2. Facebook Integratie
    if (facebookPageId && session.facebookToken) {
      const pagesRes = await fetch(`https://graph.facebook.com/me/accounts?access_token=${session.facebookToken}`);
      const pagesData = await pagesRes.json();
      const page = pagesData.data?.find((p: any) => p.id === facebookPageId);
      
      if (page?.access_token) {
        const unixTime = Math.floor(new Date(scheduleTime).getTime() / 1000);
        const fbRes = await fetch(`https://graph.facebook.com/${facebookPageId}/live_videos`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            description,
            status: "SCHEDULED_UNPUBLISHED",
            planned_start_time: unixTime,
            access_token: page.access_token
          })
        });
        
        const fbData = await fbRes.json();
        
        // Stap 2.2: Upload Thumbnail naar Facebook (Indien aanwezig)
        if (fbData.id && thumbnailUrl && thumbnailUrl.startsWith("data:image")) {
          const base64Data = thumbnailUrl.split(",")[1];
          const imageBlob = new Blob([Buffer.from(base64Data, 'base64')], { type: 'image/png' });
          
          const formData = new FormData();
          formData.append('source', imageBlob, 'thumbnail.png');
          formData.append('is_preferred', 'true');
          formData.append('access_token', page.access_token);

          fetch(`https://graph.facebook.com/${fbData.id}/thumbnails`, {
            method: "POST",
            body: formData
          }).catch(err => console.error("Facebook Thumbnail Upload Fout:", err));
        }
      }
    }

    return NextResponse.json({ success: true });

  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
