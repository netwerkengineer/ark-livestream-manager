import fs from 'fs';
import path from 'path';
import type { ParsedEmail, ParsedItem } from './emailParser';

const DATA_DIR = path.join(process.cwd(), 'data');
const STORE_FILE = path.join(DATA_DIR, 'draftServices.json');

export interface DraftSong {
  id: string;
  title: string;
  category?: string;
  section: string;
  source: 'email';
  addedAt: string;
}

export interface DraftScripture {
  id: string;
  book: string;
  chapter: number;
  verseStart: number;
  verseEnd?: number;
  translation: string;
  section: string;
  addedAt: string;
}

export interface DraftMedia {
  id: string;
  mediaType: 'youtube' | 'attachment' | 'link';
  url?: string;
  attachmentName?: string;
  filePath?: string;
  section: string;
  addedAt: string;
}

export interface SourceEmailRecord {
  messageId?: string;
  subject?: string;
  receivedAt: string;
  notes: string[];
}

export interface UnassignedEmailRecord extends SourceEmailRecord {
  excerpt: string;
}

export interface DraftService {
  id: string; // = serviceDate
  serviceDate: string;
  songs: DraftSong[];
  scriptures: DraftScripture[];
  media: DraftMedia[];
  sourceEmails: SourceEmailRecord[];
  lastUpdatedAt: string;
  lastGeneratedHash?: string;
  lastGeneratedAt?: string;
}

interface StoreShape {
  services: Record<string, DraftService>;
  unassigned: UnassignedEmailRecord[];
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readStore(): StoreShape {
  if (fs.existsSync(STORE_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(STORE_FILE, 'utf-8'));
      return { services: parsed.services || {}, unassigned: parsed.unassigned || [] };
    } catch (e) {
      console.error('[DraftServices] Kon opslagbestand niet lezen, start leeg:', e);
    }
  }
  return { services: {}, unassigned: [] };
}

function writeStore(store: StoreShape) {
  ensureDataDir();
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2));
}

export function getDraftServices(): DraftService[] {
  const store = readStore();
  return Object.values(store.services).sort((a, b) => a.serviceDate.localeCompare(b.serviceDate));
}

export function getDraftService(serviceDate: string): DraftService | null {
  const store = readStore();
  return store.services[serviceDate] || null;
}

export function getUnassignedEmails(): UnassignedEmailRecord[] {
  return readStore().unassigned;
}

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function dedupeSongTitle(existing: DraftSong[], title: string): boolean {
  const normalized = title.trim().toLowerCase();
  return existing.some(s => s.title.trim().toLowerCase() === normalized);
}

function isDuplicateScripture(existing: DraftScripture[], item: Extract<ParsedItem, { type: 'scripture' }>): boolean {
  return existing.some(s =>
    s.book === item.book &&
    s.chapter === item.chapter &&
    s.verseStart === item.verseStart &&
    s.verseEnd === item.verseEnd &&
    s.translation.trim().toLowerCase() === item.translation.trim().toLowerCase()
  );
}

function isDuplicateMedia(existing: DraftMedia[], item: Extract<ParsedItem, { type: 'media' }>): boolean {
  return existing.some(m => {
    if (m.mediaType !== item.mediaType) return false;
    if (item.url) return m.url === item.url;
    if (item.attachmentName) return m.attachmentName?.trim().toLowerCase() === item.attachmentName.trim().toLowerCase();
    return false;
  });
}

/**
 * Merges one parsed email into the draft service for its service date,
 * creating the draft if it doesn't exist yet. If the email had no
 * recognizable service date, it's stored under `unassigned` instead so
 * nothing is silently lost - it needs manual triage in the review tab.
 */
export function mergeParsedEmailIntoDraft(
  parsed: ParsedEmail,
  emailMeta: { messageId?: string; subject?: string; receivedAt: string; excerpt: string }
): DraftService | null {
  const store = readStore();

  if (!parsed.serviceDate) {
    store.unassigned.push({
      messageId: emailMeta.messageId,
      subject: emailMeta.subject,
      receivedAt: emailMeta.receivedAt,
      notes: parsed.notes,
      excerpt: emailMeta.excerpt
    });
    writeStore(store);
    return null;
  }

  const now = new Date().toISOString();
  let draft = store.services[parsed.serviceDate];

  // Safety net: if this exact message was already merged (e.g. re-synced
  // after a transient error elsewhere), don't process it again.
  if (draft && emailMeta.messageId && draft.sourceEmails.some(e => e.messageId === emailMeta.messageId)) {
    return draft;
  }

  if (!draft) {
    draft = {
      id: parsed.serviceDate,
      serviceDate: parsed.serviceDate,
      songs: [],
      scriptures: [],
      media: [],
      sourceEmails: [],
      lastUpdatedAt: now
    };
    store.services[parsed.serviceDate] = draft;
  }

  for (const item of parsed.items as ParsedItem[]) {
    if (item.type === 'song') {
      if (!dedupeSongTitle(draft.songs, item.title)) {
        draft.songs.push({
          id: newId(),
          title: item.title,
          category: item.category,
          section: item.section,
          source: 'email',
          addedAt: now
        });
      }
    } else if (item.type === 'scripture') {
      if (!isDuplicateScripture(draft.scriptures, item)) {
        draft.scriptures.push({
          id: newId(),
          book: item.book,
          chapter: item.chapter,
          verseStart: item.verseStart,
          verseEnd: item.verseEnd,
          translation: item.translation,
          section: item.section,
          addedAt: now
        });
      }
    } else if (item.type === 'media') {
      if (!isDuplicateMedia(draft.media, item)) {
        draft.media.push({
          id: newId(),
          mediaType: item.mediaType,
          url: item.url,
          attachmentName: item.attachmentName,
          filePath: item.filePath,
          section: item.section,
          addedAt: now
        });
      }
    }
  }

  draft.sourceEmails.push({
    messageId: emailMeta.messageId,
    subject: emailMeta.subject,
    receivedAt: emailMeta.receivedAt,
    notes: parsed.notes
  });
  draft.lastUpdatedAt = now;

  writeStore(store);
  return draft;
}
