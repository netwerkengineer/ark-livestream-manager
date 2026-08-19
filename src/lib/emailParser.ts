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

// Whether a (trimmed) line looks like an item that belongs to the given
// block - used to decide if a blank line inside that block is just visual
// spacing between items (very common from webmail clients) rather than the
// end of the block.
function looksLikeBlockItem(line: string, block: BlockType): boolean {
  switch (block) {
    case 'song':
      return line.startsWith('-');
    case 'scripture':
      return SCRIPTURE_LINE_RE.test(line);
    case 'media':
      return YOUTUBE_RE.test(line) || ATTACHMENT_RE.test(line) || URL_RE.test(line);
    default:
      return false;
  }
}

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

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Inline lyrics block for the song mentioned just above - captured
    // ahead of the blank-line-ends-block rule below, since verses/refrein
    // are usually separated by blank lines and those must be preserved.
    if (lyricsCapture) {
      if (LYRICS_END_RE.test(line)) {
        if (lyricsCapture.song) {
          lyricsCapture.song.lyricsText = lyricsCapture.buffer.join('\n').trim();
        }
        lyricsCapture = null;
      } else {
        lyricsCapture.buffer.push(line);
      }
      continue;
    }

    if (!line) {
      // A blank line ends the current block (paragraph) UNLESS the next
      // real content still belongs to it - webmail clients routinely put a
      // blank line between a block's header and its first item, and between
      // every item after that, so a single blank line must not blow away an
      // entire list. Trailing text like a sign-off ("Groetjes, Jan") after
      // the last item still correctly closes the block, since it won't
      // look like an item of it.
      if (currentBlock) {
        let j = i + 1;
        while (j < lines.length && !lines[j].trim()) j++;
        const next = j < lines.length ? lines[j].trim() : '';
        if (!next || !looksLikeBlockItem(next, currentBlock)) {
          currentBlock = null;
        }
      }
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
