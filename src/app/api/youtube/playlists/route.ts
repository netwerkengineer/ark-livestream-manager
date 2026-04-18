import { NextResponse } from "next/server";
import { auth } from "@/auth";

export async function GET() {
  const session: any = await auth();
  
  if (!session || !session.youtubeToken) {
    return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
  }

  try {
    const res = await fetch("https://www.googleapis.com/youtube/v3/playlists?part=snippet&mine=true&maxResults=50", {
      headers: { Authorization: `Bearer ${session.youtubeToken}` },
      cache: 'no-store'
    });
    
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
