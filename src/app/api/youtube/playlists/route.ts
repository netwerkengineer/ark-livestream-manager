import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/authHelper";
import { youtubeFetch } from "@/lib/tokenStore";

export async function GET(req: NextRequest) {
  const authSession = await isAuthorized(req, "admin");
  if (!authSession) {
    return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
  }

  try {
    const res = await youtubeFetch("https://www.googleapis.com/youtube/v3/playlists?part=snippet&mine=true&maxResults=50", {
      cache: 'no-store'
    });
    
    if (res.status === 401) {
      return NextResponse.json({ error: "YouTube verbinding verlopen. Koppel opnieuw." }, { status: 401 });
    }

    const data = await res.json();
    
    if (data.error) {
      throw new Error(data.error.message);
    }

    const playlists = (data.items || []).map((item: any) => ({
      id: item.id,
      title: item.snippet.title
    }));

    return NextResponse.json({ playlists });
  } catch (error: any) {
    console.error("[YouTube Playlists] Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
