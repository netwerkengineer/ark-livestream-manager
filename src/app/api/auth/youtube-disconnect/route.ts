import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/authHelper";
import { clearGoogleTokens } from "@/lib/tokenStore";
import { logActivity } from "@/lib/activityLog";

export async function POST(req: NextRequest) {
  const authSession = await isAuthorized(req, "admin");
  if (!authSession) {
    return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
  }

  clearGoogleTokens();
  logActivity("settings", `YouTube-koppeling losgekoppeld door ${authSession.username}.`);

  return NextResponse.json({ success: true });
}
