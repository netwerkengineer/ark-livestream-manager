import fs from "fs";
import path from "path";
import { getSettings } from "./settingsStore";

const TOKEN_FILE = path.join(process.cwd(), "data", "tokens.json");

export function saveToken(provider: string, token: string) {
  let tokens: any = {};
  if (fs.existsSync(TOKEN_FILE)) {
    try {
      tokens = JSON.parse(fs.readFileSync(TOKEN_FILE, "utf-8"));
    } catch (e) {
      tokens = {};
    }
  }
  tokens[provider] = token;
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
}

export function getTokens() {
  if (fs.existsSync(TOKEN_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(TOKEN_FILE, "utf-8"));
    } catch (e) {
      return {};
    }
  }
  return {};
}

export async function refreshYoutubeToken(): Promise<string | null> {
  const tokens = getTokens();
  const refreshToken = tokens.google_refresh;
  if (!refreshToken) {
    console.error("[YouTube Token] No refresh token found in tokens.json");
    return null;
  }

  const settings = getSettings();
  const clientId = settings.googleClientId;
  const clientSecret = settings.googleClientSecret;

  if (!clientId || !clientSecret) {
    console.error("[YouTube Token] Missing googleClientId or googleClientSecret in settings");
    return null;
  }

  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[YouTube Token] Failed to refresh token: ${res.status} ${errText}`);
      return null;
    }

    const data = await res.json();
    if (data.access_token) {
      console.log("[YouTube Token] Successfully refreshed access token.");
      saveToken("google", data.access_token);
      return data.access_token;
    }
  } catch (err) {
    console.error("[YouTube Token] Error refreshing token:", err);
  }

  return null;
}

export async function youtubeFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const tokens = getTokens();
  const token = tokens.google;

  const headers: any = {
    ...(init.headers || {}),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  // Perform initial fetch
  let res = await fetch(url, { ...init, headers });

  // If unauthorized (expired token), attempt refresh
  if (res.status === 401) {
    console.log("[YouTube Fetch] Received 401, trying to refresh access token...");
    const newToken = await refreshYoutubeToken();
    if (newToken) {
      // Retry request with new token
      headers["Authorization"] = `Bearer ${newToken}`;
      res = await fetch(url, { ...init, headers });
    }
  }

  return res;
}
