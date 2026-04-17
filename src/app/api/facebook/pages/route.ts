import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";

export async function GET(req: NextRequest) {
  const session: any = await auth();
  
  // Gebruik de facebookToken uit de sessie (of het archief via de session callback)
  const token = session?.facebookToken;

  if (!token) {
    return NextResponse.json({ error: "Geen Facebook token gevonden" }, { status: 401 });
  }

  try {
    const res = await fetch(`https://graph.facebook.com/me/accounts?access_token=${token}`);
    const data = await res.json();

    console.log("Facebook Pages API Response:", JSON.stringify(data));

    if (data.error) {
      throw new Error(data.error.message);
    }

    return NextResponse.json({ pages: data.data || [] });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
