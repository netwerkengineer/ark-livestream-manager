import { timingSafeEqual } from "crypto";
import { getSettings } from "./settingsStore";

// The desktop app identifies itself in its user agent and, when the beheerder has set a key (Instellingen ->
// Tracks), with a cookie that only the app sets. /desktop and the requests for the app's own engine are refused
// without it. This is on top of the login and the permissions, not instead of them.
export const DESKTOP_COOKIE = "ark_desktop";
export const DESKTOP_AGENT = "ArkTracksDesktop";

export function hasDesktopAccess(userAgent: string | null | undefined, cookie: string | undefined): boolean {
  if (!(userAgent || "").includes(DESKTOP_AGENT)) return false;
  const key = getSettings().desktopKey || "";
  if (!key) return true;
  if (!cookie) return false;
  const a = Buffer.from(cookie), b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}
