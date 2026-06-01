import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSettings, saveSettings } from "@/lib/settingsStore";

export async function GET() {
  const settings = getSettings();
  // We return settings anyway so the frontend can check isSetupComplete
  return NextResponse.json(settings);
}

export async function POST(req: NextRequest) {
  const currentSettings = getSettings();
  const session = await auth();

  // Allow saving without session ONLY if setup is not yet complete
  if (!session && currentSettings.isSetupComplete) {
    return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
  }

  try {
    const newSettings = await req.json();
    const updated = saveSettings(newSettings);
    
    // Trigger a restart if API keys were updated, to reload NextAuth config
    if (newSettings.googleClientId) {
      console.log("API keys updated. Triggering server restart in 1s...");
      setTimeout(() => {
        process.exit(0);
      }, 1000);
    }

    return NextResponse.json(updated);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
