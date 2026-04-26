import { NextRequest, NextResponse } from "next/server";
import { sendQlcScene } from "@/lib/qlcControl";

export async function POST(req: NextRequest) {
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
