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

// A correction directive rather than something to add - matched against the
// EXISTING items already on the draft service at merge time (the parser
// itself has no access to the draft, so it can only capture what to look
// for; draftServicesStore.mergeParsedEmailIntoDraft does the actual
// matching and removal). Lets a worship leader send a short follow-up
// mail fixing a mistake instead of the whole service having to be wiped
// and re-sent.
export interface ParsedRemoval {
  type: 'song' | 'scripture' | 'media';
  raw: string; // the text as typed, used for song/media matching and shown back in notes
  book?: string; // scripture only, already resolved to the canonical BIBLE_BOOKS name
  chapter?: number;
  verseStart?: number;
  verseEnd?: number;
}

export interface ParsedEmail {
  serviceDate: string | null; // ISO "YYYY-MM-DD"
  items: ParsedItem[];
  removals: ParsedRemoval[];
  notes: string[];
}

const SECTION_RE = /^\[\s*sectie\s*:\s*(.+?)\s*\]$/i;
const SERVICE_DATE_RE = /^dienst\s*datum\s*:\s*(.+)$/i;
// Correction directives - recognized anywhere at top level (like SECTION_RE/
// SERVICE_DATE_RE), regardless of the current block, so a short follow-up
// mail can mix a removal with new items in one go.
const REMOVE_SONG_RE = /^verwijder\s+lied\s*:\s*(.+)$/i;
const REMOVE_SCRIPTURE_RE = /^verwijder\s+bijbeltekst\s*:\s*(.+)$/i;
const REMOVE_MEDIA_RE = /^verwijder\s+media\s*:\s*(.+)$/i;
const SONG_BLOCK_RE = /^liederen(?:\s*\(\s*categorie\s*:\s*(.+?)\s*\))?\s*:?\s*$/i;
// The optional "(VERTALING)" here sets a default translation for every
// line in the block below - lets a whole batch of references share one
// translation instead of repeating it per line (mirrors the existing
// "Liederen (categorie: X):" convention).
const SCRIPTURE_BLOCK_RE = /^bijbeltekst(en)?(?:\s*\(\s*(.+?)\s*\))?\s*:?\s*$/i;
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
// Book/chapter separator is \s* (not \s+) so a WhatsApp-style reference
// pasted without a space before the chapter number, e.g. "2 Cor.12: 9",
// still splits correctly - the leading (.+?) is non-greedy so it still
// backtracks to the shortest valid book name either way. The trailing
// "(VERTALING)" is optional here since a whole block can share one
// translation via SCRIPTURE_BLOCK_RE instead (see currentScriptureTranslation).
const SCRIPTURE_LINE_RE = /^(.+?)\s*(\d+)\s*:\s*(\d+)(?:\s*-\s*(\d+))?(?:\s*\(\s*([^)]+?)\s*\))?\s*$/;
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

// Common Dutch Bible book abbreviations, as actually used in the wild
// (church WhatsApp groups, older printed liturgies) - keys are normalized
// (lowercase, diacritics folded, no trailing period) and map to the exact
// spelling used in BIBLE_BOOKS. Not exhaustive; findBibleBook() also falls
// back to unambiguous-prefix matching for anything not listed here.
const BIBLE_BOOK_ABBREVIATIONS: Record<string, string> = {
  'gen': 'Genesis', 'ex': 'Exodus', 'exod': 'Exodus', 'lev': 'Leviticus', 'num': 'Numeri',
  'deut': 'Deuteronomium', 'dt': 'Deuteronomium', 'joz': 'Jozua', 'recht': 'Rechters', 'ri': 'Rechters',
  '1 sam': '1 Samuël', '2 sam': '2 Samuël', '1 kon': '1 Koningen', '2 kon': '2 Koningen',
  '1 kron': '1 Kronieken', '2 kron': '2 Kronieken', 'neh': 'Nehemia', 'est': 'Esther',
  'ps': 'Psalmen', 'psalm': 'Psalmen', 'spr': 'Spreuken', 'pred': 'Prediker', 'hoogl': 'Hooglied',
  'jes': 'Jesaja', 'jer': 'Jeremia', 'klaagl': 'Klaagliederen', 'ez': 'Ezechiël', 'ezech': 'Ezechiël',
  'dan': 'Daniël', 'hos': 'Hosea', 'joel': 'Joël', 'jl': 'Joël', 'am': 'Amos', 'ob': 'Obadja',
  'mi': 'Micha', 'mich': 'Micha', 'nah': 'Nahum', 'hab': 'Habakuk', 'sef': 'Sefanja', 'hag': 'Haggaï',
  'zach': 'Zacharia', 'mal': 'Maleachi',
  'matt': 'Mattheüs', 'mt': 'Mattheüs', 'mark': 'Marcus', 'mc': 'Marcus', 'luk': 'Lukas', 'lc': 'Lukas',
  'joh': 'Johannes', 'hand': 'Handelingen', 'rom': 'Romeinen',
  '1 kor': '1 Korinthiërs', '1 cor': '1 Korinthiërs', '2 kor': '2 Korinthiërs', '2 cor': '2 Korinthiërs',
  'gal': 'Galaten', 'ef': 'Efeziërs', 'fil': 'Filippenzen', 'kol': 'Kolossenzen',
  '1 thess': '1 Thessalonicenzen', '2 thess': '2 Thessalonicenzen',
  '1 tim': '1 Timotheüs', '2 tim': '2 Timotheüs', 'tit': 'Titus', 'filem': 'Filemon',
  'hebr': 'Hebreeën', 'heb': 'Hebreeën', 'jak': 'Jakobus', '1 petr': '1 Petrus', '1 pe': '1 Petrus',
  '2 petr': '2 Petrus', '2 pe': '2 Petrus', '1 joh': '1 Johannes', '2 joh': '2 Johannes',
  '3 joh': '3 Johannes', 'jud': 'Judas', 'openb': 'Openbaring', 'op': 'Openbaring'
};

function findBibleBook(name: string): string | null {
  // Strip periods (abbreviations are typically written "Ef." or "1 Kor.")
  // and collapse whitespace before comparing, so "Ef.", "Ef .", "Ef" all
  // normalize the same way.
  const normalized = foldDiacritics(name.trim().toLowerCase()).replace(/\./g, '').replace(/\s+/g, ' ').trim();

  const exact = BIBLE_BOOKS.find(b => foldDiacritics(b.toLowerCase()) === normalized);
  if (exact) return exact;

  const abbreviated = BIBLE_BOOK_ABBREVIATIONS[normalized];
  if (abbreviated) return abbreviated;

  // Last resort: an unambiguous prefix match (e.g. "Efez" -> "Efeziërs")
  // for anything not covered by the table above.
  const prefixMatches = BIBLE_BOOKS.filter(b => foldDiacritics(b.toLowerCase()).startsWith(normalized));
  if (prefixMatches.length === 1) return prefixMatches[0];

  return null;
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

  // The standard internet signature delimiter (RFC 3676): a line that's
  // exactly "-- " (many mail clients insert this automatically before a
  // signature block). Normally on its own line, but a gap in some mail's
  // HTML-to-text conversion can glue it onto the tail of the preceding
  // content line instead (confirmed live: a YouTube link ending up as
  // "...aN9--", corrupting the URL, while the real signature lines below
  // it each got flagged as "Niet herkend" one by one). Handled once, up
  // front, before the main line-by-line parse even starts: whichever line
  // has this - exactly "--", or real content immediately followed by "--"
  // at the end - marks where content stops. Everything from there on,
  // including the "--" itself, is dropped.
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === '--') {
      lines.length = i;
      break;
    }
    const trailingSig = trimmed.match(/^(.*\S)\s*--$/);
    if (trailingSig) {
      lines[i] = trailingSig[1];
      lines.length = i + 1;
      break;
    }
  }

  let serviceDate: string | null = null;
  let currentSection = '';
  let currentBlock: BlockType = null;
  let currentSongCategory: string | undefined;
  let currentScriptureTranslation: string | undefined;
  let lastSong: ParsedSong | null = null;
  let lyricsCapture: { song: ParsedSong | null; buffer: string[] } | null = null;
  const items: ParsedItem[] = [];
  const removals: ParsedRemoval[] = [];
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

    // Correction directives - top-level, like the date/section headers
    // above: recognized regardless of currentBlock so a removal and a new
    // item can appear anywhere in the same follow-up mail. The actual
    // matching against what's already on the draft happens later in
    // draftServicesStore.mergeParsedEmailIntoDraft, which is the only place
    // that has access to the existing service.
    const removeSongMatch = line.match(REMOVE_SONG_RE);
    if (removeSongMatch) {
      removals.push({ type: 'song', raw: removeSongMatch[1].trim() });
      continue;
    }

    const removeScriptureMatch = line.match(REMOVE_SCRIPTURE_RE);
    if (removeScriptureMatch) {
      const target = removeScriptureMatch[1].trim();
      const m = target.match(SCRIPTURE_LINE_RE);
      if (m) {
        const [, bookRaw, chapter, verseStart, verseEnd] = m;
        const book = findBibleBook(bookRaw);
        if (book) {
          removals.push({
            type: 'scripture',
            raw: target,
            book,
            chapter: Number(chapter),
            verseStart: Number(verseStart),
            verseEnd: verseEnd ? Number(verseEnd) : undefined
          });
        } else {
          notes.push(`Bijbelboek niet herkend in verwijder-opdracht: "${bookRaw.trim()}" in "${line}"`);
        }
      } else {
        notes.push(`Niet herkend als bijbeltekst om te verwijderen (verwacht "Boek H:V-V"): "${line}"`);
      }
      continue;
    }

    const removeMediaMatch = line.match(REMOVE_MEDIA_RE);
    if (removeMediaMatch) {
      removals.push({ type: 'media', raw: removeMediaMatch[1].trim() });
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

    const scriptureBlockMatch = line.match(SCRIPTURE_BLOCK_RE);
    if (scriptureBlockMatch) {
      currentBlock = 'scripture';
      currentScriptureTranslation = scriptureBlockMatch[2]?.trim();
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
          // parse (just without a detected artist). Exception: the
          // catalog's own naming convention for songbook-bundle categories
          // (Opwekking, Johannes de Heer, etc., often but not always sent
          // with "... OPS Pro ..." in the category name) is "Zangbundelnaam
          // Nummer - Titel" instead (e.g. "Opw 643 - Al voor mijn leven is
          // ontstaan") - the part after the hyphen there is the real title,
          // not an artist. Detected two ways since a sender doesn't always
          // bother typing the category: the category name itself, OR the
          // shape of the text before the hyphen (a short code + number,
          // nothing else - "Opw 643", "JdH 9062", "Bap 161", "Tien 69").
          // Splitting it the normal way would mislabel the real title as an
          // "artist" (shown dimmed in the reviewtab) and feed the wrong two
          // strings to the internet lyrics lookup - catalog matching itself
          // is unaffected either way (checkLocalSongExists does two order-
          // agnostic substring checks), so this is purely about keeping the
          // fields meaningful.
          const [rawTitlePart, rawArtistPart] = m[1].split(/\s+-\s+/, 2);
          const looksLikeSongbookCode = !!rawArtistPart && /^[a-zëïöü]+\.?\s*\d+$/i.test(rawTitlePart.trim());
          const isSongbookCategory = !!currentSongCategory && /ops\s*pro/i.test(currentSongCategory);
          const [titlePart, artistPart] = (isSongbookCategory || looksLikeSongbookCode)
            ? [m[1], undefined]
            : [rawTitlePart, rawArtistPart];
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
        const resolvedTranslation = translation?.trim() || currentScriptureTranslation;
        if (!book) {
          notes.push(`Bijbelboek niet herkend: "${bookRaw.trim()}" in "${line}"`);
        } else if (!resolvedTranslation) {
          notes.push(`Geen vertaling opgegeven voor "${line}" (zet 'm achter de regel tussen haakjes, of één keer achter "Bijbeltekst(en) (VERTALING):" voor het hele blok).`);
        } else {
          items.push({
            type: 'scripture',
            section: currentSection,
            book,
            chapter: Number(chapter),
            verseStart: Number(verseStart),
            verseEnd: verseEnd ? Number(verseEnd) : undefined,
            translation: resolvedTranslation
          });
        }
      } else {
        notes.push(`Niet herkend als bijbeltekst (verwacht "Boek H:V-V" of "Boek H:V-V (VERTALING)"): "${line}"`);
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

  return { serviceDate, items, removals, notes };
}
