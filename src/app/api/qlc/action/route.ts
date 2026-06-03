import { NextRequest, NextResponse } from "next/server";
import { sendQlcScene, sendQlcValue } from "@/lib/qlcControl";

export async function POST(req: NextRequest) {
  try {
    const { sceneId, path, value } = await req.json();
    
    if (path !== undefined && value !== undefined) {
      sendQlcValue(path, value);
      return NextResponse.json({ success: true });
    }
    
    if (sceneId === undefined) {
      return NextResponse.json({ error: "No sceneId or path/value provided" }, { status: 400 });
    }

    sendQlcScene(sceneId);
    
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
