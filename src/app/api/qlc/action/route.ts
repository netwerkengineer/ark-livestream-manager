import { NextRequest, NextResponse } from "next/server";
import { sendQlcScene, sendQlcOsc } from "@/lib/qlcControl";
import { isAuthorized } from "@/lib/authHelper";

export async function POST(req: NextRequest) {
  const authSession = await isAuthorized(req, undefined, "lights");
  if (!authSession) {
    return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
  }

  try {
    const { sceneId, path, value } = await req.json();
    
    if (sceneId !== undefined) {
      sendQlcScene(sceneId);
      return NextResponse.json({ success: true });
    }

    if (path !== undefined && value !== undefined) {
      sendQlcOsc(path, value);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "No sceneId or path/value provided" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
