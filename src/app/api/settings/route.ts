import { NextRequest, NextResponse } from "next/server";
import { getSettings, saveSettings } from "@/lib/settingsStore";
import { isAuthorized } from "@/lib/authHelper";

export async function GET(req: NextRequest) {
  const settings = getSettings();
  
  // If setup is not complete, return everything for setup wizard
  if (!settings.isSetupComplete) {
    return NextResponse.json(settings);
  }

  const authSession = await isAuthorized(req);
  if (!authSession) {
    return NextResponse.json({ error: "Niet geautoriseerd", isSetupComplete: true }, { status: 401 });
  }

  // Strip users credentials always
  const sanitized = { ...settings } as any;
  delete sanitized.users;

  // If it's an operator, strip all other secrets
  if (authSession.role !== "admin") {
    delete sanitized.googleClientSecret;
    delete sanitized.facebookClientSecret;
    delete sanitized.nextAuthSecret;
    delete sanitized.obsPassword;
    delete sanitized.tuyaLocalKey;
    if (sanitized.tuyaPlugs) {
      sanitized.tuyaPlugs = sanitized.tuyaPlugs.map((p: any) => {
        const { localKey, ...rest } = p;
        return rest;
      });
    }
  }

  return NextResponse.json({
    ...sanitized,
    currentUser: authSession.username,
    userRole: authSession.role
  });
}

export async function POST(req: NextRequest) {
  const currentSettings = getSettings();
  
  // If setup is complete, verify admin role
  if (currentSettings.isSetupComplete) {
    const authSession = await isAuthorized(req, "admin");
    if (!authSession) {
      return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
    }
  }

  try {
    const newSettings = await req.json();
    
    // Preserve users array (managed via /api/users)
    if (currentSettings.users) {
      newSettings.users = currentSettings.users;
    }
    
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
