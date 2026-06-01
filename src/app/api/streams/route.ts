import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSettings } from "@/lib/settingsStore";

export async function GET() {
  const session: any = await auth();
  const settings = getSettings();
  
  if (!session) {
    return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
  }

  const streams: any[] = [];

  try {
    // 1. Haal YouTube Streams op
    if (session.youtubeToken) {
      console.log(`[YouTube] Ophalen streams met token prefix: ${session.youtubeToken.substring(0, 10)}...`);
      // NOTE: broadcastStatus=all mag NIET expliciet worden meegegeven als mine=true wordt gebruikt.
      // Het is echter de standaardwaarde als mine=true.
      const ytRes = await fetch("https://www.googleapis.com/youtube/v3/liveBroadcasts?part=snippet,status&mine=true&maxResults=50", {
        headers: { Authorization: `Bearer ${session.youtubeToken}` },
        cache: 'no-store'
      });
      const ytData = await ytRes.json();
      
      if (ytData.error) {
        console.error("[YouTube] API Fout:", JSON.stringify(ytData.error));
      } else if (ytData.items) {
        console.log(`[YouTube] ${ytData.items.length} items gevonden.`);
        if (ytData.items.length > 0) {
          console.log(`[YouTube] Status eerste item: ${ytData.items[0].status.lifeCycleStatus}`);
        }
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
      }
    }

    // 2. Haal Facebook Streams op - VERWIJDERD

    console.log(`Totaal ${streams.length} streams gevonden.`);

    // Sorteer op tijd
    streams.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

    return NextResponse.json({ streams });
  } catch (error: any) {
    console.error("Critical API Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const session: any = await auth();
  const settings = getSettings();
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  const provider = searchParams.get("provider");

  if (!session || !id || !provider) {
    return NextResponse.json({ error: "Ongeldige aanvraag" }, { status: 400 });
  }

  try {
    if (provider === "youtube") {
      const res = await fetch(`https://www.googleapis.com/youtube/v3/liveBroadcasts?id=${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.youtubeToken}` }
      });
      if (!res.ok && res.status !== 204) {
        const data = await res.json();
        throw new Error(data.error?.message || "YouTube verwijderen mislukt");
      }
    } else {
      throw new Error("Onbekende of niet-ondersteunde provider");
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
