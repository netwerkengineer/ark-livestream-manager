import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const DATA_DIR = path.join(process.cwd(), 'data');
const STORE_FILE = path.join(DATA_DIR, 'contacts.json');

export interface Contact {
  id: string;
  name: string;
  role: 'band' | 'operator' | 'other';
  email?: string;
  active?: boolean; // soft-disable without deleting (someone leaves the team temporarily)
  // Set when this contact came from the SSO identity provider (Authentik/
  // Synology) rather than being typed in by hand via TeamSettings.tsx -
  // externalId is that provider's own id for the person (OIDC `sub`, or an
  // LDAP DN), used to match them up again on the next sync/login without
  // depending on name/email staying exactly the same.
  source?: 'manual' | 'sso';
  externalId?: string;
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function getContacts(): Contact[] {
  if (fs.existsSync(STORE_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(STORE_FILE, 'utf-8'));
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.error('[Contacts] Kon opslagbestand niet lezen, start leeg:', e);
    }
  }
  return [];
}

export function saveContacts(contacts: Contact[]): void {
  ensureDataDir();
  fs.writeFileSync(STORE_FILE, JSON.stringify(contacts, null, 2));
  try {
    fs.chmodSync(STORE_FILE, 0o666);
  } catch (e) {
    // best-effort, matches the cross-container permission pattern used
    // elsewhere in this app (e.g. activityLog.ts) - not fatal if it fails
  }
}

// Rough, best-effort guess at a Contact's role from their SSO group names -
// just a sensible default for a newly-synced person; nothing stops someone
// adjusting it afterwards in TeamSettings.tsx like any other contact.
function inferRoleFromGroups(groups: string[]): Contact['role'] {
  const lower = groups.map(g => g.toLowerCase());
  if (lower.some(g => g.includes('band') || g.includes('worship'))) return 'band';
  if (lower.some(g => g.includes('operator') || g.includes('techniek') || g.includes('beamer'))) return 'operator';
  return 'other';
}

// Called opportunistically from auth.ts's jwt callback whenever someone
// logs in via the SSO provider - gets them into the team contact list
// immediately rather than waiting for the next scheduled
// teamDirectorySync.ts run. Never touches manually-added contacts.
export function upsertContactFromSso(opts: { name: string; email: string; groups: string[]; externalId: string }): Contact {
  const contacts = getContacts();
  const idx = contacts.findIndex(c => c.source === 'sso' && (c.externalId === opts.externalId || c.email?.toLowerCase() === opts.email.toLowerCase()));
  if (idx >= 0) {
    contacts[idx] = { ...contacts[idx], name: opts.name, email: opts.email, externalId: opts.externalId, source: 'sso' };
    saveContacts(contacts);
    return contacts[idx];
  }
  const created: Contact = {
    id: crypto.randomUUID(),
    name: opts.name,
    email: opts.email,
    role: inferRoleFromGroups(opts.groups),
    active: true,
    source: 'sso',
    externalId: opts.externalId
  };
  contacts.push(created);
  saveContacts(contacts);
  return created;
}

// The bulk counterpart used by teamDirectorySync.ts's periodic sync - adds/
// updates every member of the synced directory group(s), and removes any
// previously-synced ('source: sso') contact that's no longer among them
// (someone left the group). Manually-added contacts (source 'manual', or
// undefined for anything created before this feature existed) are never
// touched, added, or removed by this function.
export function upsertContactsFromDirectory(members: Array<{ name: string; email: string; groups: string[]; externalId: string }>): void {
  const contacts = getContacts();
  const seenExternalIds = new Set(members.map(m => m.externalId));

  const kept = contacts.filter(c => c.source !== 'sso' || seenExternalIds.has(c.externalId || ''));
  const byExternalId = new Map(kept.filter(c => c.source === 'sso').map(c => [c.externalId, c]));

  for (const member of members) {
    const existing = byExternalId.get(member.externalId);
    if (existing) {
      existing.name = member.name;
      existing.email = member.email;
    } else {
      kept.push({
        id: crypto.randomUUID(),
        name: member.name,
        email: member.email,
        role: inferRoleFromGroups(member.groups),
        active: true,
        source: 'sso',
        externalId: member.externalId
      });
    }
  }

  saveContacts(kept);
}
