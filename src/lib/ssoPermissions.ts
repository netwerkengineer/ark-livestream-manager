import { getSettings } from "./settingsStore";

// Split out from authHelper.ts to avoid a circular import: auth.ts needs
// this to compute session.role/permissions at login, but authHelper.ts
// itself imports `auth` from auth.ts - this file depends on neither.
//
// Resolves an SSO login's role/permissions from their identity provider
// groups (Authentik on test, Synology SSO Server in production) against
// settings.ssoGroupPermissions - a group not listed there grants nothing,
// so a valid SSO login with no recognized group ends up with no usable
// access, without needing a separate "may not log in" rule.
export function resolveSsoPermissions(groups: string[]): { role: "admin" | "operator"; permissions: string[] } {
  const settings = getSettings();
  const map = settings.ssoGroupPermissions || {};
  let role: "admin" | "operator" = "operator";
  const permissions = new Set<string>();
  for (const group of groups) {
    const entry = map[group];
    if (!entry) continue;
    if (entry.role === "admin") role = "admin";
    (entry.permissions || []).forEach(p => permissions.add(p));
  }
  if (role === "admin") {
    return { role, permissions: ["planner", "control", "monitor", "lights", "tracks", "oefenen", "freeshow"] };
  }
  return { role, permissions: Array.from(permissions) };
}
