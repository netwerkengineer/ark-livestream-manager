import { NextRequest, NextResponse } from "next/server";
import { getSettings, saveSettings } from "@/lib/settingsStore";
import { isAuthorized, generateSalt, hashPassword } from "@/lib/authHelper";

export async function GET(req: NextRequest) {
  const authSession = await isAuthorized(req, "admin");
  if (!authSession) {
    return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
  }

  const settings = getSettings();
  const users = settings.users || [];
  
  // Return users without hashes/salts for security
  const safeUsers = users.map(u => ({
    username: u.username,
    role: u.role
  }));

  return NextResponse.json({ users: safeUsers });
}

export async function POST(req: NextRequest) {
  const authSession = await isAuthorized(req, "admin");
  if (!authSession) {
    return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
  }

  try {
    const { username, password, role } = await req.json();
    if (!username || !role) {
      return NextResponse.json({ error: "Gebruikersnaam en rol zijn verplicht" }, { status: 400 });
    }

    const settings = getSettings();
    const users = [...(settings.users || [])];
    const existingIdx = users.findIndex(u => u.username.toLowerCase() === username.toLowerCase());

    if (existingIdx >= 0) {
      // Update existing user
      const user = users[existingIdx];
      user.role = role;
      if (password) {
        const salt = generateSalt();
        user.salt = salt;
        user.passwordHash = hashPassword(password, salt);
      }
      users[existingIdx] = user;
    } else {
      // Add new user
      if (!password) {
        return NextResponse.json({ error: "Wachtwoord is verplicht voor nieuwe gebruikers" }, { status: 400 });
      }
      const salt = generateSalt();
      users.push({
        username,
        role,
        salt,
        passwordHash: hashPassword(password, salt)
      });
    }

    saveSettings({ users });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const authSession = await isAuthorized(req, "admin");
  if (!authSession) {
    return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
  }

  try {
    const parsedUrl = new URL(req.url);
    const username = parsedUrl.searchParams.get("username");
    
    if (!username) {
      return NextResponse.json({ error: "Gebruikersnaam is verplicht" }, { status: 400 });
    }

    // Protect against self-deletion
    if (authSession.username.toLowerCase() === username.toLowerCase()) {
      return NextResponse.json({ error: "Je kunt je eigen account niet verwijderen" }, { status: 400 });
    }

    const settings = getSettings();
    const users = settings.users || [];
    
    const adminCount = users.filter(u => u.role === "admin").length;
    const targetUser = users.find(u => u.username.toLowerCase() === username.toLowerCase());
    
    if (targetUser && targetUser.role === "admin" && adminCount <= 1) {
      return NextResponse.json({ error: "Kan de laatste beheerder niet verwijderen" }, { status: 400 });
    }

    const filteredUsers = users.filter(u => u.username.toLowerCase() !== username.toLowerCase());
    saveSettings({ users: filteredUsers });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
