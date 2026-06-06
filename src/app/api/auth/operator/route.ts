import { NextRequest, NextResponse } from "next/server";
import { getSettings } from "@/lib/settingsStore";
import { hashPassword, encryptSession } from "@/lib/authHelper";

export async function POST(req: NextRequest) {
  try {
    const { username, password } = await req.json();
    if (!username || !password) {
      return NextResponse.json({ error: "Gebruikersnaam en wachtwoord zijn verplicht" }, { status: 400 });
    }

    const settings = getSettings();
    const users = settings.users || [];
    
    // Find matching user (case-insensitive username)
    const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
    if (!user) {
      return NextResponse.json({ error: "Gebruikersnaam of wachtwoord onjuist" }, { status: 401 });
    }

    // Verify password hash
    const computedHash = hashPassword(password, user.salt);
    if (computedHash !== user.passwordHash) {
      return NextResponse.json({ error: "Gebruikersnaam of wachtwoord onjuist" }, { status: 401 });
    }

    // Encrypt session token
    const token = encryptSession({ username: user.username, role: user.role });
    const response = NextResponse.json({ success: true, username: user.username, role: user.role });
    
    // Set cookie for 30 days
    response.cookies.set("operator_session", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      path: "/",
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60, // 30 days
    });

    return response;
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE() {
  const response = NextResponse.json({ success: true });
  response.cookies.set("operator_session", "", {
    path: "/",
    expires: new Date(0),
  });
  return response;
}
