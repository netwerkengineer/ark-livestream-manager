import fs from 'fs';
import path from 'path';
import type { ParsedEmail, ParsedItem, ParsedRemoval } from './emailParser';
import { foldDiacritics } from './freeshowUtils';

const DATA_DIR = path.join(process.cwd(), 'data');
const STORE_FILE = path.join(DATA_DIR, 'draftServices.json');

export interface DraftSong {
  id: string;
  title: string;
  artist?: string;
  category?: string;
  section: string;
  source: 'email';
  addedAt: string;
  lyricsText?: string;
  lyricsAttachmentName?: string;
  lyricsFilePath?: string; // resolved by the caller once matched against real email attachments
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
  projectFilePath?: string;
  lastGenerationNotes?: string[];
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

// Draft services are otherwise kept indefinitely (no automatic expiry) - a
// medewerker removes one manually once the service has passed and the
// generated FreeShow project is no longer needed for reference. This only
// removes the draft record itself, not any .project file already generated
// from it on the NAS.
export function deleteDraftService(serviceDate: string): boolean {
  const store = readStore();
  if (!store.services[serviceDate]) return false;
  delete store.services[serviceDate];
  writeStore(store);
  return true;
}

// Dismisses one unassigned-mail entry (e.g. a test mail, or a genuinely
// irrelevant mail that happened to match the subject keyword) from the
// review tab. Doesn't touch the actual mailbox - the source email itself
// was already marked \Seen when it was fetched, this only removes the
// local record of it needing manual triage.
export function deleteUnassignedEmail(messageId: string): boolean {
  const store = readStore();
  const before = store.unassigned.length;
  store.unassigned = store.unassigned.filter(u => u.messageId !== messageId);
  if (store.unassigned.length === before) return false;
  writeStore(store);
  return true;
}

// Removes one song/scripture/media item from a draft service by id, e.g.
// from the 🗑️ button next to a single item in the review tab - lets a
// mistake be corrected without wiping and re-sending the whole service.
export function removeItemFromDraft(serviceDate: string, itemType: 'song' | 'scripture' | 'media', itemId: string): boolean {
  const store = readStore();
  const draft = store.services[serviceDate];
  if (!draft) return false;

  let removed = false;
  if (itemType === 'song') {
    const before = draft.songs.length;
    draft.songs = draft.songs.filter(s => s.id !== itemId);
    removed = draft.songs.length !== before;
  } else if (itemType === 'scripture') {
    const before = draft.scriptures.length;
    draft.scriptures = draft.scriptures.filter(s => s.id !== itemId);
    removed = draft.scriptures.length !== before;
  } else {
    const before = draft.media.length;
    draft.media = draft.media.filter(m => m.id !== itemId);
    removed = draft.media.length !== before;
  }

  if (!removed) return false;
  draft.lastUpdatedAt = new Date().toISOString();
  writeStore(store);
  return true;
}

function foldForMatch(s: string): string {
  return foldDiacritics(s.trim().toLowerCase());
}

// Matches a "Verwijder lied: X" target against a song's title. Two shapes
// are accepted, checked independently so this works regardless of whether
// the song was originally stored split ("Titel"/"Artiest" in separate
// fields) or as one opaque string (the "... OPS Pro ..." category case in
// emailParser.ts, where "Zangbundelnaam - Titel" is deliberately kept
// whole): (a) the raw text matches the song's reconstructed full display
// name outright, or (b) split the same way a song ADD line would be, with
// both title and (if given) artist matching. Either shape matching is
// enough - a correction mail shouldn't have to know how the original
// addition happened to store the name.
function songMatchesRemoval(song: DraftSong, raw: string): boolean {
  const fullName = song.artist ? `${song.title} - ${song.artist}` : song.title;
  if (foldForMatch(fullName) === foldForMatch(raw)) return true;

  const [titlePart, artistPart] = raw.split(/\s+-\s+/, 2);
  if (foldForMatch(song.title) !== foldForMatch(titlePart)) return false;
  if (artistPart && song.artist) return foldForMatch(song.artist) === foldForMatch(artistPart);
  return true;
}

function mediaMatchesRemoval(media: DraftMedia, raw: string): boolean {
  const target = foldForMatch(raw);
  const candidate = foldForMatch(media.url || media.attachmentName || '');
  if (!candidate) return false;
  return candidate === target || candidate.includes(target) || target.includes(candidate);
}

// Applies every removal directive from one parsed email against a draft's
// existing items, returning a Dutch note per directive (found-and-removed,
// or not-found) so the outcome is always visible in the reviewtab - same
// "never silently guess" principle as the rest of the parser.
function applyRemovals(draft: DraftService, removals: ParsedRemoval[]): string[] {
  const notes: string[] = [];
  for (const removal of removals) {
    if (removal.type === 'song') {
      const before = draft.songs.length;
      draft.songs = draft.songs.filter(s => !songMatchesRemoval(s, removal.raw));
      const count = before - draft.songs.length;
      notes.push(count > 0
        ? `Lied "${removal.raw}" verwijderd${count > 1 ? ` (${count}x)` : ''}.`
        : `Kon lied "${removal.raw}" niet verwijderen: geen match gevonden in deze dienst.`);
    } else if (removal.type === 'scripture') {
      const before = draft.scriptures.length;
      draft.scriptures = draft.scriptures.filter(s => !(
        s.book === removal.book &&
        s.chapter === removal.chapter &&
        s.verseStart === removal.verseStart &&
        (s.verseEnd ?? null) === (removal.verseEnd ?? null)
      ));
      const count = before - draft.scriptures.length;
      notes.push(count > 0
        ? `Bijbeltekst "${removal.raw}" verwijderd${count > 1 ? ` (${count}x)` : ''}.`
        : `Kon bijbeltekst "${removal.raw}" niet verwijderen: geen match gevonden in deze dienst.`);
    } else {
      const before = draft.media.length;
      draft.media = draft.media.filter(m => !mediaMatchesRemoval(m, removal.raw));
      const count = before - draft.media.length;
      notes.push(count > 0
        ? `Media "${removal.raw}" verwijderd${count > 1 ? ` (${count}x)` : ''}.`
        : `Kon media "${removal.raw}" niet verwijderen: geen match gevonden in deze dienst.`);
    }
  }
  return notes;
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
    const notes = [...parsed.notes];
    if (parsed.removals.length > 0) {
      notes.push('Deze mail bevatte verwijder-opdrachten, maar kon niet aan een dienst gekoppeld worden - controleer de dienstdatum en stuur de correctie opnieuw.');
    }
    store.unassigned.push({
      messageId: emailMeta.messageId,
      subject: emailMeta.subject,
      receivedAt: emailMeta.receivedAt,
      notes,
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
          artist: item.artist,
          category: item.category,
          section: item.section,
          source: 'email',
          addedAt: now,
          lyricsText: item.lyricsText,
          lyricsAttachmentName: item.lyricsAttachmentName,
          lyricsFilePath: item.lyricsFilePath
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

  const removalNotes = applyRemovals(draft, parsed.removals);

  draft.sourceEmails.push({
    messageId: emailMeta.messageId,
    subject: emailMeta.subject,
    receivedAt: emailMeta.receivedAt,
    notes: [...parsed.notes, ...removalNotes]
  });
  draft.lastUpdatedAt = now;

  writeStore(store);
  return draft;
}

/**
 * Records the result of generating/overwriting the FreeShow project for a
 * service date - the hash lets a future generation detect whether the file
 * was changed outside the app (directly in FreeShow) since we last wrote it.
 */
export function updateGenerationInfo(
  serviceDate: string,
  info: { hash: string; filePath: string; generatedAt: string; notes?: string[] }
): DraftService | null {
  const store = readStore();
  const draft = store.services[serviceDate];
  if (!draft) return null;

  draft.lastGeneratedHash = info.hash;
  draft.lastGeneratedAt = info.generatedAt;
  draft.projectFilePath = info.filePath;
  draft.lastGenerationNotes = info.notes || [];

  writeStore(store);
  return draft;
}
