import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/authHelper";
import { youtubeFetch } from "@/lib/tokenStore";
import { checkAndSyncUpcomingStreamThumbnail } from "@/lib/thumbnailSync";

export async function GET(req: NextRequest) {
  const authSession = await isAuthorized(req, undefined, "planner");
  if (!authSession) {
    return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
  }

  const streams: any[] = [];

  try {
    // 1. Haal YouTube Streams op
    const ytRes = await youtubeFetch("https://www.googleapis.com/youtube/v3/liveBroadcasts?part=snippet,status&mine=true&maxResults=50", {
      cache: 'no-store'
    });
    
    if (ytRes.status === 401) {
      return NextResponse.json({ error: "YouTube verbinding is verlopen of ongeldig. Koppel opnieuw." }, { status: 401 });
    }

    const ytData = await ytRes.json();
    
    if (ytData.error) {
      console.error("[YouTube] API Fout:", JSON.stringify(ytData.error));
    } else if (ytData.items) {
      console.log(`[YouTube] ${ytData.items.length} items gevonden.`);
      ytData.items.forEach((item: any) => {
        // We tonen alles behalve afgeronde of verwijderde streams
        if (item.status.lifeCycleStatus !== "complete" && item.status.lifeCycleStatus !== "revoked") {
          streams.push({
            id: item.id,
            title: item.snippet.title,
            startTime: item.snippet.scheduledStartTime,
            provider: "youtube",
            status: item.status.lifeCycleStatus,
            embedUrl: `https://www.youtube.com/watch?v=${item.id}`
          });
        }
      });

      // Achtergrond thumbnail sync voor de eerstvolgende stream - gedeelde
      // helper (src/lib/thumbnailSync.ts) die ook de 10-minuten achtergrond-
      // taak en de create/delete routes gebruiken, zodat er nog maar één
      // plek is die "wat is de eerstvolgende stream" berekent.
      checkAndSyncUpcomingStreamThumbnail().catch(err => console.error("Thumbnail Sync Trigger error:", err));
    }

    // Sorteer op tijd
    streams.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

    return NextResponse.json({ streams });
  } catch (error: any) {
    console.error("Critical API Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
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
      const res = await youtubeFetch(`https://www.googleapis.com/youtube/v3/liveBroadcasts?id=${id}`, {
        method: "DELETE"
      });
      if (!res.ok && res.status !== 204) {
        const data = await res.json();
        throw new Error(data.error?.message || "YouTube verwijderen mislukt");
      }
    } else {
      throw new Error("Onbekende of niet-ondersteunde provider");
    }

    // Verwijderde stream kan de huidige eerstvolgende zijn geweest - zorg
    // dat thema.jpg meteen doorschuift naar wat er nu eerstvolgend is,
    // in plaats van te wachten op de 10-minuten achtergrondtaak.
    checkAndSyncUpcomingStreamThumbnail().catch(err => console.error("Thumbnail Sync Trigger error (na verwijderen):", err));

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
