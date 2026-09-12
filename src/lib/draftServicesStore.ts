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
  source: 'email' | 'manual';
  addedAt: string;
  lyricsText?: string;
  lyricsAttachmentName?: string;
  lyricsFilePath?: string; // resolved by the caller once matched against real email attachments
  chordsText?: string; // free-text, hand-entered by a worship leader - never parsed/rendered as ChordPro
  chordsFileName?: string; // original filename of an uploaded chord chart (txt/pdf), e.g. a band's own scanned sheet
  chordsFilePath?: string; // where that upload was saved - attached verbatim rather than retyped into chordsText
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

// Creates the draft for a service date if it doesn't exist yet, otherwise
// returns the existing one untouched - shared by the email pipeline
// (mergeParsedEmailIntoDraft) and the worship-leader-facing setlist builder,
// so a service that started life from a liturgie mail and one built by hand
// end up as the exact same kind of record either way.
export function createOrGetDraftService(serviceDate: string): DraftService {
  const store = readStore();
  let draft = store.services[serviceDate];
  if (!draft) {
    draft = {
      id: serviceDate,
      serviceDate,
      songs: [],
      scriptures: [],
      media: [],
      sourceEmails: [],
      lastUpdatedAt: new Date().toISOString()
    };
    store.services[serviceDate] = draft;
    writeStore(store);
  }
  return draft;
}

// Adds one song directly (not from a parsed email) - used by the setlist
// builder UI. Same dedupe-by-title behaviour as the email pipeline so
// re-adding a song already on the list is a no-op rather than a duplicate row.
export function addSongToDraft(
  serviceDate: string,
  song: { title: string; artist?: string; category?: string; section: string; lyricsText?: string; chordsText?: string; chordsFileName?: string; chordsFilePath?: string }
): DraftService {
  const store = readStore();
  let draft = store.services[serviceDate];
  if (!draft) {
    draft = {
      id: serviceDate,
      serviceDate,
      songs: [],
      scriptures: [],
      media: [],
      sourceEmails: [],
      lastUpdatedAt: new Date().toISOString()
    };
    store.services[serviceDate] = draft;
  }

  if (!dedupeSongTitle(draft.songs, song.title, song.artist, song.section)) {
    draft.songs.push({
      id: newId(),
      title: song.title,
      artist: song.artist,
      category: song.category,
      section: song.section,
      source: 'manual',
      addedAt: new Date().toISOString(),
      lyricsText: song.lyricsText,
      chordsText: song.chordsText,
      chordsFileName: song.chordsFileName,
      chordsFilePath: song.chordsFilePath
    });
  }
  draft.lastUpdatedAt = new Date().toISOString();
  writeStore(store);
  return draft;
}

// Adds one Bible reading directly (not from a parsed email) - same
// dedupe-by-reference behaviour as the email pipeline.
export function addScriptureToDraft(
  serviceDate: string,
  scripture: { book: string; chapter: number; verseStart: number; verseEnd?: number; translation: string; section: string }
): DraftService {
  const store = readStore();
  let draft = store.services[serviceDate];
  if (!draft) {
    draft = {
      id: serviceDate,
      serviceDate,
      songs: [],
      scriptures: [],
      media: [],
      sourceEmails: [],
      lastUpdatedAt: new Date().toISOString()
    };
    store.services[serviceDate] = draft;
  }

  if (!isDuplicateScripture(draft.scriptures, scripture)) {
    draft.scriptures.push({
      id: newId(),
      book: scripture.book,
      chapter: scripture.chapter,
      verseStart: scripture.verseStart,
      verseEnd: scripture.verseEnd,
      translation: scripture.translation,
      section: scripture.section,
      addedAt: new Date().toISOString()
    });
  }
  draft.lastUpdatedAt = new Date().toISOString();
  writeStore(store);
  return draft;
}

// Adds one media item directly (not from a parsed email) - same
// dedupe-by-url/attachment behaviour as the email pipeline.
export function addMediaToDraft(
  serviceDate: string,
  media: { mediaType: 'youtube' | 'attachment' | 'link'; url?: string; attachmentName?: string; filePath?: string; section: string }
): DraftService {
  const store = readStore();
  let draft = store.services[serviceDate];
  if (!draft) {
    draft = {
      id: serviceDate,
      serviceDate,
      songs: [],
      scriptures: [],
      media: [],
      sourceEmails: [],
      lastUpdatedAt: new Date().toISOString()
    };
    store.services[serviceDate] = draft;
  }

  if (!isDuplicateMedia(draft.media, media)) {
    draft.media.push({
      id: newId(),
      mediaType: media.mediaType,
      url: media.url,
      attachmentName: media.attachmentName,
      filePath: media.filePath,
      section: media.section,
      addedAt: new Date().toISOString()
    });
  }
  draft.lastUpdatedAt = new Date().toISOString();
  writeStore(store);
  return draft;
}

// Edits an existing song in place (title/section/lyrics/chords/...) - there
// was previously no update path, only add/remove, which meant a worship
// leader couldn't fix a typo or paste in lyrics/chords after the fact
// without deleting and re-adding the song (losing its position in the list).
export function updateSongInDraft(
  serviceDate: string,
  songId: string,
  patch: Partial<Pick<DraftSong, 'title' | 'artist' | 'category' | 'section' | 'lyricsText' | 'chordsText' | 'chordsFileName' | 'chordsFilePath'>>
): DraftService | null {
  const store = readStore();
  const draft = store.services[serviceDate];
  if (!draft) return null;

  const song = draft.songs.find(s => s.id === songId);
  if (!song) return null;

  Object.assign(song, patch);
  draft.lastUpdatedAt = new Date().toISOString();
  writeStore(store);
  return draft;
}

// Reorders songs to match orderedIds exactly - any id from the current list
// that's missing from orderedIds is dropped to the end (defensive; the
// caller is expected to pass every song's id, but a stale client shouldn't
// be able to silently delete songs via a partial reorder request).
export function reorderSongsInDraft(serviceDate: string, orderedIds: string[]): DraftService | null {
  const store = readStore();
  const draft = store.services[serviceDate];
  if (!draft) return null;

  const byId = new Map(draft.songs.map(s => [s.id, s]));
  const reordered: DraftSong[] = [];
  for (const id of orderedIds) {
    const song = byId.get(id);
    if (song) {
      reordered.push(song);
      byId.delete(id);
    }
  }
  // Anything not mentioned in orderedIds keeps its relative order, appended.
  reordered.push(...byId.values());

  draft.songs = reordered;
  draft.lastUpdatedAt = new Date().toISOString();
  writeStore(store);
  return draft;
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

// Title+artist+section, not title alone - a song legitimately repeated in
// two sections (e.g. the same opener sung again as closer) must not be
// silently dropped just because the title already appears earlier in the
// service, and two different songs that happen to share a title (different
// artist) shouldn't collide either. Still blocks a true accidental
// duplicate - same song, same section, added twice (a re-run mail sync, or
// someone clicking "+" twice).
function dedupeSongTitle(existing: DraftSong[], title: string, artist: string | undefined, section: string): boolean {
  const normalizedTitle = title.trim().toLowerCase();
  const normalizedArtist = (artist || '').trim().toLowerCase();
  const normalizedSection = section.trim().toLowerCase();
  return existing.some(s =>
    s.title.trim().toLowerCase() === normalizedTitle &&
    (s.artist || '').trim().toLowerCase() === normalizedArtist &&
    s.section.trim().toLowerCase() === normalizedSection
  );
}

function isDuplicateScripture(existing: DraftScripture[], item: { book: string; chapter: number; verseStart: number; verseEnd?: number; translation: string }): boolean {
  return existing.some(s =>
    s.book === item.book &&
    s.chapter === item.chapter &&
    s.verseStart === item.verseStart &&
    s.verseEnd === item.verseEnd &&
    s.translation.trim().toLowerCase() === item.translation.trim().toLowerCase()
  );
}

function isDuplicateMedia(existing: DraftMedia[], item: { mediaType: 'youtube' | 'attachment' | 'link'; url?: string; attachmentName?: string }): boolean {
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
      if (!dedupeSongTitle(draft.songs, item.title, item.artist, item.section)) {
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
  const notes = [...parsed.notes, ...removalNotes];

  // A worship leader/operator's natural recovery move when something in an
  // e-mail didn't come through right is to mark it unread and hit "Check nu"
  // again - every item type above is already deduped per-item, so
  // reprocessing the same message is safe and can pick up anything that
  // failed the first time (e.g. a parser bug since fixed). Update the
  // existing sourceEmails entry in place rather than skip it entirely (the
  // old behavior) or append a second entry for the same message - that way
  // the notes shown also refresh instead of staying stuck on a stale error.
  const existingSourceEmail = emailMeta.messageId
    ? draft.sourceEmails.find(e => e.messageId === emailMeta.messageId)
    : undefined;
  if (existingSourceEmail) {
    existingSourceEmail.notes = notes;
    existingSourceEmail.receivedAt = emailMeta.receivedAt;
  } else {
    draft.sourceEmails.push({
      messageId: emailMeta.messageId,
      subject: emailMeta.subject,
      receivedAt: emailMeta.receivedAt,
      notes
    });
  }
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
