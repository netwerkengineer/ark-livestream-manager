import https from "https";
import http from "http";
import { getSettings, AppSettings } from "./settingsStore";
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

// Deferred: Directory Server (LDAP) would add a permanently-running domain
// controller service to a NAS that's already tight on RAM (it crashes its
// Docker daemon under memory pressure during app builds - see
// project_nas_docker_oom_during_build). The DSM web API below avoids
// installing anything extra, at the cost of using Synology's own
// thinly-documented endpoints instead of a standard protocol.
async function fetchSynologyLdapMembers(_groupName: string): Promise<DirectoryMember[]> {
  throw new Error("synology-ldap is niet geïmplementeerd (bewust - zie de code-comment bij fetchSynologyLdapMembers)");
}

// Minimal JSON-over-HTTP(S) helper for DSM's webapi/entry.cgi. Uses the
// Node http/https modules directly (rather than fetch) so a self-signed
// certificate on a LAN-only DSM address (e.g. https://192.168.2.250:5001)
// can be trusted without needing a real cert just for this internal call -
// this NEVER applies to any other outbound request in the app.
function dsmRequest(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const isHttps = url.startsWith("https://");
    const client = isHttps ? https : http;
    const req = client.get(url, isHttps ? { rejectUnauthorized: false } : {}, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          reject(new Error(`DSM gaf geen geldige JSON terug (HTTP ${res.statusCode})`));
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(10000, () => req.destroy(new Error("DSM API timeout")));
  });
}

async function dsmLogin(baseUrl: string, account: string, password: string): Promise<string> {
  const url = `${baseUrl}/webapi/entry.cgi?api=SYNO.API.Auth&version=6&method=login&account=${encodeURIComponent(account)}&passwd=${encodeURIComponent(password)}&session=LivestreamManager&format=sid`;
  const data = await dsmRequest(url);
  if (!data.success) {
    throw new Error(`DSM login mislukt (foutcode ${data?.error?.code ?? "onbekend"}) - controleer ssoDirectoryApiUser/ssoDirectoryApiToken`);
  }
  return data.data.sid;
}

// Not yet verified against a live DSM instance - built from Synology's
// undocumented-but-observed SYNO.Core.Group.Member / SYNO.Core.User APIs
// (no first-party spec exists, see the plan's note on this). Needs a real
// test run once the app is deployed on the NAS; exact error codes/shapes
// may need adjusting then.
async function fetchSynologyApiMembers(groupName: string): Promise<DirectoryMember[]> {
  const settings = getSettings();
  if (!settings.ssoDirectoryApiUrl) throw new Error("ssoDirectoryApiUrl (DSM-adres, bv. https://192.168.2.250:5001) is niet ingesteld");
  if (!settings.ssoDirectoryApiUser) throw new Error("ssoDirectoryApiUser is niet ingesteld");
  if (!settings.ssoDirectoryApiToken) throw new Error("ssoDirectoryApiToken (DSM-wachtwoord) is niet ingesteld");

  const baseUrl = settings.ssoDirectoryApiUrl.replace(/\/$/, "");
  const sid = await dsmLogin(baseUrl, settings.ssoDirectoryApiUser, settings.ssoDirectoryApiToken);

  const membersData = await dsmRequest(
    `${baseUrl}/webapi/entry.cgi?api=SYNO.Core.Group.Member&version=1&method=list&group=${encodeURIComponent(groupName)}&in_group=true&_sid=${sid}`
  );
  if (!membersData.success) {
    throw new Error(`DSM kon groep "${groupName}" niet ophalen (foutcode ${membersData?.error?.code ?? "onbekend"})`);
  }
  // The (undocumented) response nests members under data.users as full
  // {name, description, uid} objects, not data.members as plain username
  // strings - confirmed by inspecting a live response, since no official
  // spec exists for this endpoint.
  const userEntries: { name: string; description?: string }[] = Array.isArray(membersData?.data?.users) ? membersData.data.users : [];

  const members: DirectoryMember[] = [];
  for (const entry of userEntries) {
    const additional = encodeURIComponent(JSON.stringify(["email"]));
    const userData = await dsmRequest(
      `${baseUrl}/webapi/entry.cgi?api=SYNO.Core.User&version=1&method=get&name=${encodeURIComponent(entry.name)}&additional=${additional}&_sid=${sid}`
    );
    const user = userData?.data?.user;
    if (!user?.email) continue; // no email on file for this account - nothing to send a setlist to
    members.push({
      name: entry.description || entry.name,
      email: user.email,
      groups: [groupName],
      externalId: entry.name
    });
  }

  return members;
}

async function fetchGroupMembers(mode: AppSettings["ssoDirectoryMode"], groupName: string): Promise<DirectoryMember[]> {
  switch (mode) {
    case "synology-ldap":
      return fetchSynologyLdapMembers(groupName);
    case "synology-api":
      return fetchSynologyApiMembers(groupName);
    case "authentik-api":
    default:
      return fetchAuthentikGroupMembers(groupName);
  }
}

export async function syncTeamDirectory(): Promise<{ synced: number }> {
  const settings = getSettings();
  const groups = settings.ssoContactSyncGroups || [];
  if (!settings.ssoContactSyncEnabled || groups.length === 0) {
    return { synced: 0 };
  }

  // A failed fetch throws and never reaches upsertContactsFromDirectory, so
  // a bad/empty response from the provider never wipes out the existing
  // contact list - one broken group name shouldn't take down the sync for
  // every other group, so each is fetched independently and errors are
  // logged rather than aborting the whole run.
  const membersByEmail = new Map<string, DirectoryMember>();
  for (const groupName of groups) {
    try {
      const members = await fetchGroupMembers(settings.ssoDirectoryMode, groupName);
      for (const member of members) {
        const existing = membersByEmail.get(member.email);
        if (existing) {
          existing.groups = Array.from(new Set([...existing.groups, ...member.groups]));
        } else {
          membersByEmail.set(member.email, member);
        }
      }
    } catch (err) {
      console.error(`[Team Directory Sync] Groep "${groupName}" overslaan:`, err);
    }
  }

  const members = Array.from(membersByEmail.values());
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
