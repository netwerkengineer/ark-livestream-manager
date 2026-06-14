import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/authHelper";
import { youtubeFetch } from "@/lib/tokenStore";
import fs from "fs";
import path from "path";

export async function POST(req: NextRequest) {
  const authSession = await isAuthorized(req, undefined, "planner");
  if (!authSession) {
    return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
  }

  const { title, description, scheduleTime, thumbnailUrl, privacyStatus, categoryId, playlistId, tags } = await req.json();

  try {
    // 1. YouTube Integratie: Haal de eerste liveStream key op
    const streamsRes = await youtubeFetch("https://www.googleapis.com/youtube/v3/liveStreams?mine=true&part=id,cdn");
    const streamsData = await streamsRes.json();
    
    if (streamsData.error) {
       throw new Error(`YouTube API Fout: ${streamsData.error.message}`);
    }

    const streamId = streamsData.items?.[0]?.id;

    if (!streamId) {
      throw new Error("Geen actieve stream key gevonden op YouTube.");
    }

    // Stap 1.2: Maak broadcast aan
    const broadcastRes = await youtubeFetch("https://www.googleapis.com/youtube/v3/liveBroadcasts?part=snippet,status,contentDetails", {
      method: "POST",
      headers: { 
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
    const bindRes = await youtubeFetch(`https://www.googleapis.com/youtube/v3/liveBroadcasts/bind?id=${broadcastId}&streamId=${streamId}&part=id`, {
      method: "POST"
    });
    if (!bindRes.ok) {
      const bindErr = await bindRes.json();
      throw new Error(`YouTube Bind Fout: ${bindErr.error?.message || bindRes.statusText}`);
    }

    // Stap 1.3b: Voeg toe aan playlist indien opgegeven
    if (playlistId) {
      youtubeFetch("https://www.googleapis.com/youtube/v3/playlistItems?part=snippet", {
        method: "POST",
        headers: { 
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
      youtubeFetch(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${broadcastId}&uploadType=media`, {
        method: "POST",
        headers: { 
          "Content-Type": "image/png"
        },
        body: imageBuffer
      }).catch(err => console.error("YouTube Thumbnail Upload Fout:", err));

      // Sla lokaal op (Voor OBS op de NAS en FreeShow)
      try {
        const internalPath = "/app/public/thumbnails";
        if (!fs.existsSync(internalPath)) {
          fs.mkdirSync(internalPath, { recursive: true });
        }
        const filePath = path.join(internalPath, "thema.jpg");
        fs.writeFileSync(filePath, imageBuffer);
        console.log(`Thumbnail succesvol opgeslagen in Next.js public: ${filePath}`);

        const { getSettings } = require("@/lib/settingsStore");
        const settings = getSettings();
        const savePath = settings.thumbnailSavePath;
        if (savePath) {
          try {
            if (!fs.existsSync(savePath)) {
              fs.mkdirSync(savePath, { recursive: true });
            }
            const customFilePath = path.join(savePath, "thema.jpg");
            fs.writeFileSync(customFilePath, imageBuffer);
            console.log(`Thumbnail succesvol opgeslagen op custom pad: ${customFilePath}`);
          } catch (pathErr) {
            console.error(`Lokaal opslaan op custom pad ${savePath} mislukt:`, pathErr);
          }
        }
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
