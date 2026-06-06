import { NextRequest, NextResponse } from "next/server";
import { sendQlcScene } from "@/lib/qlcControl";
import { isAuthorized } from "@/lib/authHelper";

export async function POST(req: NextRequest) {
  const authSession = await isAuthorized(req);
  if (!authSession) {
    return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
  }

  try {
    const { sceneId } = await req.json();
    
    if (sceneId === undefined) {
      return NextResponse.json({ error: "No sceneId provided" }, { status: 400 });
    }

    sendQlcScene(sceneId);
    
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
