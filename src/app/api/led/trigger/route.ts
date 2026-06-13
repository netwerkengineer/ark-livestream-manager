import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/authHelper";
import { getSettings } from "@/lib/settingsStore";
import { handleStreamStateChange } from "@/lib/obsManager";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const settings = getSettings();
  const { searchParams } = new URL(req.url);
  const statusParam = searchParams.get("status");
  const tokenParam = searchParams.get("token");
  const textParam = searchParams.get("text");
  const colorParam = searchParams.get("color");

  // Check auth: either via NextAuthSecret token (for Companion) or session cookies (for web app)
  let authorized = false;
  if (tokenParam && settings.nextAuthSecret && tokenParam === settings.nextAuthSecret) {
    authorized = true;
  }

  if (!authorized) {
    const authSession = await isAuthorized(req, undefined, "control");
    if (authSession) {
      authorized = true;
    }
  }

  if (!authorized) {
    return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
  }

  if (statusParam !== "active" && statusParam !== "inactive") {
    return NextResponse.json({ error: "Ongeldige status. Gebruik 'active' of 'inactive'." }, { status: 400 });
  }

  const isActive = statusParam === "active";
  
  if (!settings.ledPanelEnabled) {
    return NextResponse.json({ 
      success: false, 
      error: "LED Paneel staat niet ingeschakeld in de instellingen (Hardware Verbindingen)." 
    });
  }

  // Trigger remote SSH/SCP execution
  handleStreamStateChange(isActive, textParam, colorParam);

  return NextResponse.json({ 
    success: true, 
    status: statusParam,
    message: `LED-paneel status trigger verzonden: ${statusParam === 'active' ? 'ON AIR (Rood)' : 'OFFLINE (Groen)'}` 
  });
}

export async function POST(req: NextRequest) {
  return GET(req);
}
