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

    // 2. Haal Facebook Streams op
    if (session.facebookToken) {
      console.log("Ophalen Facebook streams...");
      const pagesRes = await fetch(`https://graph.facebook.com/me/accounts?access_token=${session.facebookToken}`);
      const pagesData = await pagesRes.json();
      
      if (pagesData.data) {
        for (const page of pagesData.data) {
          const fbRes = await fetch(`https://graph.facebook.com/${page.id}/live_videos?fields=id,title,planned_start_time,status,permalink_url&access_token=${page.access_token}`);
          const fbData = await fbRes.json();
          
          if (fbData.data) {
            fbData.data.forEach((item: any) => {
              if (item.status === "SCHEDULED_UNPUBLISHED" || item.status === "SCHEDULED_LIVE" || item.status === "LIVE") {
                streams.push({
                  id: item.id,
                  title: item.title || `Facebook Live (${page.name})`,
                  startTime: item.planned_start_time ? new Date(item.planned_start_time * 1000).toISOString() : new Date().toISOString(),
                  provider: "facebook",
                  status: item.status,
                  embedUrl: item.permalink_url
                });
              }
            });
          }
        }
      }
    }

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
    } else if (provider === "facebook") {
      // Page token nodig
      const pagesRes = await fetch(`https://graph.facebook.com/me/accounts?access_token=${session.facebookToken}`);
      const pagesData = await pagesRes.json();
      const page = pagesData.data?.find((p: any) => p.id === settings.defaultFacebookPageId);
      
      if (!page?.access_token) throw new Error("Fout bij ophalen Facebook Page Token");

      const res = await fetch(`https://graph.facebook.com/${id}?access_token=${page.access_token}`, {
        method: "DELETE"
      });
      const data = await res.json();
      if (!data.success) throw new Error("Facebook verwijderen mislukt");
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
