import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/authHelper";
import { youtubeFetch } from "@/lib/tokenStore";

export async function GET(req: NextRequest) {
  const authSession = await isAuthorized(req, undefined, "planner");
  if (!authSession) {
    return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
  }

  try {
    const res = await youtubeFetch("https://www.googleapis.com/youtube/v3/videoCategories?part=snippet&regionCode=NL", {
      cache: 'no-store'
    });
    
    if (res.status === 401) {
      return NextResponse.json({ error: "YouTube verbinding verlopen. Koppel opnieuw." }, { status: 401 });
    }

    const data = await res.json();
    
    if (data.error) {
      throw new Error(data.error.message);
    }

    let categories = data.items.map((item: any) => ({
      id: item.id,
      title: item.snippet.title,
      assignable: item.snippet.assignable
    }));

    // Soms geeft de API voor NL 'Nonprofits & Activism' (ID 29) niet terug als assignable, 
    // of helemaal niet, terwijl het wel bruikbaar is voor kerken.
    const hasNonProfit = categories.some((c: any) => c.id === "29");
    if (!hasNonProfit) {
      categories.push({ id: "29", title: "Nonprofits & Activism", assignable: true });
    }

    // Sorteer alfabetisch op titel
    categories.sort((a: any, b: any) => a.title.localeCompare(b.title));

    return NextResponse.json({ categories });
  } catch (error: any) {
    console.error("[YouTube Categories] Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
