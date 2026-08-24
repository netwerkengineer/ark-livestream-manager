import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/authHelper";
import { youtubeFetch } from "@/lib/tokenStore";
import { triggerFreeShowSync } from "@/lib/syncTrigger";
import fs from "fs";
import path from "path";

// Checks whether the just-created broadcast is the soonest currently-
// scheduled upcoming stream, by comparing its scheduledStartTime against
// every OTHER non-complete/non-revoked broadcast on the channel. Used to
// decide whether this stream's thumbnail should become thema.jpg - if an
// earlier-scheduled stream is still upcoming, thema.jpg must keep showing
// THAT one's thumbnail, not this newer one's.
async function isNewStreamTheSoonestUpcoming(newBroadcastId: string, newScheduleTime: string): Promise<boolean> {
  try {
    const res = await youtubeFetch(
      "https://www.googleapis.com/youtube/v3/liveBroadcasts?part=snippet,status&mine=true&maxResults=50",
      { cache: "no-store" }
    );
    const data = await res.json();
    if (data.error || !data.items) return true; // Can't verify - assume soonest, matches old (unconditional) behavior.

    const newTime = new Date(newScheduleTime).getTime();
    const earlierStreamExists = data.items.some((item: any) => {
      if (item.id === newBroadcastId) return false;
      if (item.status?.lifeCycleStatus === "complete" || item.status?.lifeCycleStatus === "revoked") return false;
      const otherTime = new Date(item.snippet?.scheduledStartTime).getTime();
      return !isNaN(otherTime) && otherTime < newTime;
    });
    return !earlierStreamExists;
  } catch (err) {
    console.error("Kon niet controleren of dit de eerstvolgende stream is:", err);
    return true;
  }
}

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
          // Bewust uit: de operator start de uitzending liever zelf
          // handmatig in YouTube, in plaats van dat 'ie automatisch begint
          // zodra er een RTMP-signaal binnenkomt.
          enableAutoStart: false,
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

      // Upload naar YouTube - bewust AFGEWACHT (niet fire-and-forget): als
      // dit endpoint "success" teruggeeft vóórdat YouTube de thumbnail
      // daadwerkelijk heeft, deelt een gebruiker die meteen de link plakt
      // 'm terwijl YouTube's eigen og:image nog het generieke fallback-
      // plaatje is - WhatsApp (en andere link-preview-crawlers) laten dan
      // geen thumbnail/omschrijving zien, en cachen dat resultaat vaak nog
      // een tijd. Een falende upload hoeft de rest van het aanmaken niet te
      // laten mislukken (de uitzending zelf staat al goed), dus fouten
      // blijven hier alleen gelogd, niet gegooid.
      try {
        const thumbRes = await youtubeFetch(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${broadcastId}&uploadType=media`, {
          method: "POST",
          headers: {
            "Content-Type": "image/png"
          },
          body: imageBuffer
        });
        if (!thumbRes.ok) {
          const thumbErr = await thumbRes.json().catch(() => null);
          console.error("YouTube Thumbnail Upload Fout:", thumbErr || thumbRes.statusText);
        }
      } catch (err) {
        console.error("YouTube Thumbnail Upload Fout:", err);
      }

      // Sla lokaal op als thema.jpg (voor OBS op de NAS en de "Welkom"-show
      // in FreeShow) - maar ALLEEN als deze nieuwe uitzending ook echt de
      // eerstvolgende geplande stream is. thema.jpg is één vast bestand dat
      // OBS/FreeShow altijd op hetzelfde pad verwachten (bewust zo, zodat
      // daar nooit iets hoeft te worden aangepast) - plan je een dienst
      // verder in de toekomst terwijl een eerdere dienst nog moet
      // plaatsvinden, dan zou een onvoorwaardelijke overschrijving de
      // eerdere (nog aankomende) dienst de verkeerde thumbnail geven.
      try {
        const isSoonest = await isNewStreamTheSoonestUpcoming(broadcastId, scheduleTime);
        if (isSoonest) {
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

          // thema.jpg staat nu alleen op de NAS - de Beamer PC leest zijn
          // eigen lokale kopie (freeshowClientPath is een lokaal Windows-
          // pad, geen netwerkschijf), dus zonder sync ziet de "Welkom"-show
          // in FreeShow deze nieuwe thumbnail pas bij de volgende
          // geplande sync. Trigger er meteen één. keepOn: false - dit is een
          // onbemande trigger (niemand zit er actief bij zoals bij de
          // handmatige syncknop), dus de Beamer PC mag er weer netjes van
          // uit na afloop. targetKeys: ['primary'] - extra doelen (bv. een
          // zondagsschool-PC) staan bijna altijd uit en syncen alleen als
          // iemand dat handmatig aanvinkt, nooit via deze automatische trigger.
          triggerFreeShowSync({ keepOn: false, targetKeys: ['primary'] }).catch(err => console.error("Kon sync niet triggeren na nieuwe thumbnail:", err));
        } else {
          console.log(`Nieuwe uitzending "${broadcastId}" is niet de eerstvolgende geplande stream - thema.jpg blijft ongewijzigd.`);
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
