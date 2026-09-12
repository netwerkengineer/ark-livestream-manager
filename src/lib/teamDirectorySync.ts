import { getSettings } from "./settingsStore";
import { upsertContactsFromDirectory } from "./contactsStore";

interface DirectoryMember {
  name: string;
  email: string;
  groups: string[];
  externalId: string;
}

// Authentik's own REST API - stable and officially documented, used as-is
// on the Proxmox test environment. The API lives at the same host as the
// OIDC issuer (just a different path), so the base URL is derived from
// settings.ssoIssuerUrl rather than needing its own setting.
async function fetchAuthentikGroupMembers(groupName: string): Promise<DirectoryMember[]> {
  const settings = getSettings();
  if (!settings.ssoIssuerUrl) throw new Error("ssoIssuerUrl is niet ingesteld");
  if (!settings.ssoDirectoryApiToken) throw new Error("ssoDirectoryApiToken (Authentik API-token) is niet ingesteld");

  const apiBase = new URL(settings.ssoIssuerUrl).origin + "/api/v3";
  const url = `${apiBase}/core/users/?groups_by_name=${encodeURIComponent(groupName)}&page_size=200`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${settings.ssoDirectoryApiToken}` }
  });
  if (!res.ok) {
    throw new Error(`Authentik API gaf ${res.status} terug bij het ophalen van groep "${groupName}"`);
  }
  const data = await res.json();
  const results: any[] = Array.isArray(data?.results) ? data.results : [];

  return results
    .filter(u => u.email)
    .map(u => ({
      name: u.name || u.username || u.email,
      email: u.email,
      groups: Array.isArray(u.groups_obj) ? u.groups_obj.map((g: any) => g.name) : [groupName],
      externalId: String(u.pk ?? u.uid ?? u.email)
    }));
}

// Not yet built - deferred until the Proxmox/Authentik path has been fully
// tested and it's actually time to tackle production (see the plan's
// rollout order). Whichever of LDAP (via the Directory Server package) or
// DSM's own web API turns out to be the practical choice on this
// resource-constrained NAS gets implemented here.
async function fetchSynologyLdapMembers(_groupName: string): Promise<DirectoryMember[]> {
  throw new Error("synology-ldap is nog niet geïmplementeerd - zie het plan voor de afweging LDAP vs. DSM-webAPI");
}

async function fetchSynologyApiMembers(_groupName: string): Promise<DirectoryMember[]> {
  throw new Error("synology-api is nog niet geïmplementeerd - zie het plan voor de afweging LDAP vs. DSM-webAPI");
}

export async function syncTeamDirectory(): Promise<{ synced: number }> {
  const settings = getSettings();
  if (!settings.ssoContactSyncEnabled || !settings.ssoContactSyncGroup) {
    return { synced: 0 };
  }

  let members: DirectoryMember[];
  switch (settings.ssoDirectoryMode) {
    case "synology-ldap":
      members = await fetchSynologyLdapMembers(settings.ssoContactSyncGroup);
      break;
    case "synology-api":
      members = await fetchSynologyApiMembers(settings.ssoContactSyncGroup);
      break;
    case "authentik-api":
    default:
      members = await fetchAuthentikGroupMembers(settings.ssoContactSyncGroup);
      break;
  }

  // A failed fetch throws above and never reaches here, so a bad/empty
  // response from the provider never wipes out the existing contact list -
  // upsertContactsFromDirectory only ever adds/updates/prunes based on
  // what this function actually returned.
  upsertContactsFromDirectory(members);
  return { synced: members.length };
}

export function initTeamDirectorySync() {
  const settings = getSettings();
  if (!settings.ssoContactSyncEnabled) return;

  console.log("[Team Directory Sync] Initializing background team contact sync task...");
  syncTeamDirectory()
    .then(r => console.log(`[Team Directory Sync] Initial sync: ${r.synced} contact(en) bijgewerkt.`))
    .catch(err => console.error("[Team Directory Sync] Initial sync error:", err));

  const intervalMinutes = settings.ssoContactSyncIntervalMinutes || 360;
  setInterval(() => {
    syncTeamDirectory()
      .then(r => console.log(`[Team Directory Sync] Scheduled sync: ${r.synced} contact(en) bijgewerkt.`))
      .catch(err => console.error("[Team Directory Sync] Scheduled sync error:", err));
  }, intervalMinutes * 60 * 1000);
}
