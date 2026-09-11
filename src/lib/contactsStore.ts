import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');
const STORE_FILE = path.join(DATA_DIR, 'contacts.json');

export interface Contact {
  id: string;
  name: string;
  role: 'band' | 'operator' | 'other';
  email?: string;
  active?: boolean; // soft-disable without deleting (someone leaves the team temporarily)
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
