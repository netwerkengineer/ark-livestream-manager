import { BIBLE_BOOKS, foldDiacritics } from './freeshowUtils';

export interface ParsedSong {
  type: 'song';
  section: string;
  title: string;
  artist?: string;
  category?: string;
  lyricsText?: string;
  lyricsAttachmentName?: string;
  lyricsFilePath?: string; // resolved by the caller once matched against real email attachments
}

export interface ParsedScripture {
  type: 'scripture';
  section: string;
  book: string;
  chapter: number;
  verseStart: number;
  verseEnd?: number;
  translation: string;
}

export interface ParsedMedia {
  type: 'media';
  section: string;
  mediaType: 'youtube' | 'attachment' | 'link';
  url?: string;
  attachmentName?: string;
  filePath?: string; // resolved by the caller once matched against real email attachments
}

export type ParsedItem = ParsedSong | ParsedScripture | ParsedMedia;

export interface ParsedEmail {
  serviceDate: string | null; // ISO "YYYY-MM-DD"
  items: ParsedItem[];
  notes: string[];
}

const SECTION_RE = /^\[\s*sectie\s*:\s*(.+?)\s*\]$/i;
const SERVICE_DATE_RE = /^dienst\s*datum\s*:\s*(.+)$/i;
const SONG_BLOCK_RE = /^liederen(?:\s*\(\s*categorie\s*:\s*(.+?)\s*\))?\s*:?\s*$/i;
const SCRIPTURE_BLOCK_RE = /^bijbeltekst(en)?\s*:?\s*$/i;
const MEDIA_BLOCK_RE = /^media\s*:?\s*$/i;
// A song line optionally carries "(bijlage: bestand.ext)" for lyrics
// supplied as a .txt/.pdf/.docx attachment, matched against real email
// attachments by the caller (same convention as the Media block's own
// "(bijlage: ...)" syntax, just inline on the song line instead of standalone).
const SONG_LINE_RE = /^-\s*(.+?)(?:\s*\(\s*bijlage\s*:\s*(.+?)\s*\))?\s*$/i;
// Inline lyrics for the song directly above: everything between these two
// markers (blank lines included, to preserve verse/refrein spacing) becomes
// that song's lyricsText instead of being split into further items.
const LYRICS_START_RE = /^\[\s*tekst\s*\]$/i;
const LYRICS_END_RE = /^\[\s*\/\s*tekst\s*\]$/i;
const SCRIPTURE_LINE_RE = /^(.+?)\s+(\d+)\s*:\s*(\d+)(?:\s*-\s*(\d+))?\s*\(\s*([^)]+?)\s*\)\s*$/;
const YOUTUBE_RE = /(https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\/\S+)/i;
const ATTACHMENT_RE = /^\(?\s*bijlage\s*:\s*(.+?)\s*\)?$/i;
const URL_RE = /^https?:\/\/\S+$/i;

function parseServiceDate(raw: string): string | null {
  const trimmed = raw.trim();
  // DD-MM-YYYY or DD/MM/YYYY
  const match = trimmed.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (!match) return null;
  const [, d, m, y] = match;
  const day = d.padStart(2, '0');
  const month = m.padStart(2, '0');
  return `${y}-${month}-${day}`;
}

function findBibleBook(name: string): string | null {
  const normalized = foldDiacritics(name.trim().toLowerCase());
  const found = BIBLE_BOOKS.find(b => foldDiacritics(b.toLowerCase()) === normalized);
  return found || null;
}

type BlockType = 'song' | 'scripture' | 'media' | null;

/**
 * Line-by-line, section-aware parser for the recommended service-email format.
 * Never guesses: anything it can't confidently classify inside a recognized
 * block is surfaced in `notes` rather than silently dropped or misfiled.
 */
export function parseServiceEmail(text: string): ParsedEmail {
  // Strip plain-text quote markers ("> ", or nested "> > ") that mail
  // clients add to forwarded/replied-to content, so a forwarded liturgie
  // mail parses the same as an original one instead of every line failing
  // to match because of a leading ">".
  const lines = (text || '').split('\n').map(l => l.replace(/^(>\s*)+/, ''));

  let serviceDate: string | null = null;
  let currentSection = '';
  let currentBlock: BlockType = null;
  let currentSongCategory: string | undefined;
  let lastSong: ParsedSong | null = null;
  let lyricsCapture: { song: ParsedSong | null; buffer: string[] } | null = null;
  const items: ParsedItem[] = [];
  const notes: string[] = [];

  for (const rawLine of lines) {
    let line = rawLine.trim();

    // Inline lyrics block for the song mentioned just above - captured
    // ahead of the blank-line-ends-block rule below, since verses/refrein
    // are usually separated by blank lines and those must be preserved.
    // Comment-stripping below intentionally doesn't apply here either - a
    // literal "#" in song lyrics (rare, but possible) must stay verbatim.
    if (lyricsCapture) {
      if (LYRICS_END_RE.test(line)) {
        if (lyricsCapture.song) {
          lyricsCapture.song.lyricsText = lyricsCapture.buffer.join('\n').trim();
        }
        lyricsCapture = null;
        continue;
      }
      // Missing [/Tekst] is an easy mistake to make, and without this check
      // it silently swallows everything that follows into the lyrics text -
      // every later song, the scripture, the whole Media block - with zero
      // trace of what happened. A genuine new section/block header (or a
      // second "Dienst datum:") is never legitimate lyrics content, so it's
      // treated as an implicit close instead, and flagged in `notes` so a
      // medewerker knows the mail itself needs a fix for next time.
      const looksLikeNewBlock =
        SERVICE_DATE_RE.test(line) || SECTION_RE.test(line) ||
        SONG_BLOCK_RE.test(line) || SCRIPTURE_BLOCK_RE.test(line) || MEDIA_BLOCK_RE.test(line);
      if (looksLikeNewBlock) {
        if (lyricsCapture.song) {
          lyricsCapture.song.lyricsText = lyricsCapture.buffer.join('\n').trim();
        }
        notes.push(`Tekstblok [Tekst]...[/Tekst] voor "${lyricsCapture.song?.title ?? 'onbekend lied'}" mist een afsluitende [/Tekst] - automatisch afgesloten bij "${line}".`);
        lyricsCapture = null;
        // Falls through so this line is still processed normally below,
        // instead of being lost along with the rest of the mail.
      } else {
        lyricsCapture.buffer.push(line);
        continue;
      }
    }

    // Defensive: strip a matching */** wrap some mail clients still emit for
    // bold/italic-formatted text even in their plain-text export, e.g.
    // "*Dienst datum: 20-08-2026*" - independent of email.ts's own HTML
    // conversion, which already avoids introducing these in the first place
    // but can't help mail that never had an HTML part to begin with.
    const boldWrap = line.match(/^(\*{1,2})(.+)\1$/);
    if (boldWrap) {
      line = boldWrap[2].trim();
    }

    // Trailing comment on an otherwise real line, e.g.
    // "- Opw 717 - Heer U Doorgrondt En Kent Mij # in een lagere toonsoort".
    // Only a "#" preceded by whitespace counts, so this never fires inside
    // a URL's "#fragment" (never preceded by a space in a well-formed URL)
    // or a chord like "F#" (no space before the "#" either) - just a plain
    // trailing " #comment" gets cut off before any further matching below.
    const trailingCommentIdx = line.indexOf(' #');
    if (trailingCommentIdx !== -1) {
      line = line.slice(0, trailingCommentIdx).trimEnd();
    }

    if (line.startsWith('#')) {
      // Explicit comment marker - always ignored, everywhere, even mid-list
      // inside an active block. Unlike stray unrecognized text (which is
      // surfaced in `notes` rather than silently dropped, see below), a
      // line the sender deliberately marked as a comment should never
      // generate a note.
      continue;
    }

    if (!line) {
      // A blank line never ends the current block by itself - only a new
      // section/block header does (matched unconditionally below,
      // regardless of currentBlock). Webmail clients routinely put a blank
      // line between a block's header and its first item, and between every
      // item after that, so treating a blank line as "end of block" would
      // silently drop every item that follows a stray comment line. Any
      // trailing content that isn't a real header or item (a sign-off, a
      // comment) still gets classified per-line below and surfaced as a
      // note rather than silently ignored or allowed to kill the rest of
      // the block - never guess, never drop.
      continue;
    }

    if (LYRICS_START_RE.test(line)) {
      if (!lastSong) {
        notes.push('Tekstblok [Tekst]...[/Tekst] gevonden zonder voorafgaand lied - genegeerd.');
      }
      lyricsCapture = { song: lastSong, buffer: [] };
      continue;
    }

    const dateMatch = line.match(SERVICE_DATE_RE);
    if (dateMatch) {
      serviceDate = parseServiceDate(dateMatch[1]);
      if (!serviceDate) {
        notes.push(`Kon dienstdatum niet lezen: "${line}"`);
      }
      continue;
    }

    const sectionMatch = line.match(SECTION_RE);
    if (sectionMatch) {
      currentSection = sectionMatch[1].trim();
      continue;
    }

    const songBlockMatch = line.match(SONG_BLOCK_RE);
    if (songBlockMatch) {
      currentBlock = 'song';
      currentSongCategory = songBlockMatch[1]?.trim();
      continue;
    }

    if (SCRIPTURE_BLOCK_RE.test(line)) {
      currentBlock = 'scripture';
      continue;
    }

    if (MEDIA_BLOCK_RE.test(line)) {
      currentBlock = 'media';
      continue;
    }

    if (currentBlock === 'song') {
      if (line.startsWith('-')) {
        const m = line.match(SONG_LINE_RE);
        if (m) {
          // Same "Titel - Artiest" split convention used elsewhere in the
          // app (e.g. the manual Bouwer's quick-add) - only the first
          // " - " counts, so titles that themselves contain a hyphen still
          // parse (just without a detected artist).
          const [titlePart, artistPart] = m[1].split(/\s+-\s+/, 2);
          const song: ParsedSong = {
            type: 'song',
            section: currentSection,
            title: titlePart.trim(),
            artist: artistPart?.trim() || undefined,
            category: currentSongCategory,
            lyricsAttachmentName: m[2]?.trim()
          };
          items.push(song);
          lastSong = song;
        } else {
          notes.push(`Niet herkend als lied (verwacht "- Titel"): "${line}"`);
        }
      } else {
        notes.push(`Niet herkend als lied (verwacht "- Titel"): "${line}"`);
      }
      continue;
    }

    if (currentBlock === 'scripture') {
      const m = line.match(SCRIPTURE_LINE_RE);
      if (m) {
        const [, bookRaw, chapter, verseStart, verseEnd, translation] = m;
        const book = findBibleBook(bookRaw);
        if (book) {
          items.push({
            type: 'scripture',
            section: currentSection,
            book,
            chapter: Number(chapter),
            verseStart: Number(verseStart),
            verseEnd: verseEnd ? Number(verseEnd) : undefined,
            translation: translation.trim()
          });
        } else {
          notes.push(`Bijbelboek niet herkend: "${bookRaw.trim()}" in "${line}"`);
        }
      } else {
        notes.push(`Niet herkend als bijbeltekst (verwacht "Boek H:V-V (VERTALING)"): "${line}"`);
      }
      continue;
    }

    if (currentBlock === 'media') {
      const ytMatch = line.match(YOUTUBE_RE);
      if (ytMatch) {
        items.push({ type: 'media', section: currentSection, mediaType: 'youtube', url: ytMatch[1] });
        continue;
      }
      const attachMatch = line.match(ATTACHMENT_RE);
      if (attachMatch) {
        items.push({ type: 'media', section: currentSection, mediaType: 'attachment', attachmentName: attachMatch[1].trim() });
        continue;
      }
      if (URL_RE.test(line)) {
        items.push({ type: 'media', section: currentSection, mediaType: 'link', url: line });
        continue;
      }
      notes.push(`Niet herkend als media (verwacht een link of "(bijlage: bestandsnaam)"): "${line}"`);
      continue;
    }

    // Line outside any recognized block (preamble/greeting/signature) - ignored silently.
  }

  return { serviceDate, items, notes };
}
