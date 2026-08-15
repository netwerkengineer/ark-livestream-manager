import { BIBLE_BOOKS } from './freeshowUtils';

export interface ParsedSong {
  type: 'song';
  section: string;
  title: string;
  category?: string;
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
  const normalized = name.trim().toLowerCase();
  const found = BIBLE_BOOKS.find(b => b.toLowerCase() === normalized);
  return found || null;
}

type BlockType = 'song' | 'scripture' | 'media' | null;

/**
 * Line-by-line, section-aware parser for the recommended service-email format.
 * Never guesses: anything it can't confidently classify inside a recognized
 * block is surfaced in `notes` rather than silently dropped or misfiled.
 */
export function parseServiceEmail(text: string): ParsedEmail {
  const lines = (text || '').split('\n');

  let serviceDate: string | null = null;
  let currentSection = '';
  let currentBlock: BlockType = null;
  let currentSongCategory: string | undefined;
  const items: ParsedItem[] = [];
  const notes: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

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
      if (line.startsWith('- ')) {
        items.push({
          type: 'song',
          section: currentSection,
          title: line.slice(2).trim(),
          category: currentSongCategory
        });
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
