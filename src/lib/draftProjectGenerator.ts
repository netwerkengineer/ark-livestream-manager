import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { getSettings } from '@/lib/settingsStore';
import { checkLocalSongExists, getLocalSongText, getLocalShowData, fetchLyricsFromInternet } from '@/lib/songs';
import { getBibleVerses } from '@/lib/bible';
import { createShowObject, createFreeShowProject, serializeProject } from '@/lib/freeshow';
import { toFreeShowClientPath, foldDiacritics } from '@/lib/freeshowUtils';
import { DraftService, DraftSong, DraftScripture, DraftMedia, updateGenerationInfo } from '@/lib/draftServicesStore';

export interface GenerateResult {
  success: boolean;
  conflict?: boolean;
  message?: string;
  notes?: string[];
}

function inferMetaType(filePath: string): 'video' | 'image' | null {
  const ext = path.extname(filePath).toLowerCase();
  if (['.mp4', '.mov', '.webm', '.m4v'].includes(ext)) return 'video';
  if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) return 'image';
  return null;
}

async function loadFreeshowCategories(settings: any): Promise<Record<string, { name: string }>> {
  if (!settings.freeshowPath) return {};
  try {
    const settingsSyncedPath = path.join(settings.freeshowPath, 'Config', 'settings_synced.json');
    const content = await fs.readFile(settingsSyncedPath, 'utf-8');
    const config = JSON.parse(content);
    return config.categories || {};
  } catch {
    return {};
  }
}

// Matches the free-text category from a "Liederen (categorie: X):" email
// header against the church's real FreeShow song categories by display name
// (not id), so an auto-created song lands next to its siblings instead of
// always in the generic default bucket. No match -> falls back to the
// built-in "song" category, which is easy to find and gets flagged in the
// generation notes rather than silently misfiled.
function resolveSongCategoryId(rawCategory: string | undefined, categories: Record<string, { name: string }>): { id: string; matched: boolean } {
  if (!rawCategory) return { id: 'song', matched: false };
  const target = foldDiacritics(rawCategory.trim().toLowerCase());
  const match = Object.entries(categories).find(([, cat]) => cat?.name && foldDiacritics(cat.name.toLowerCase()) === target);
  return match ? { id: match[0], matched: true } : { id: 'song', matched: false };
}

const sanitizeShowName = (name: string) => name.replace(/[\\/:*?"<>|]/g, ' ').trim();

// Mirrors /api/preview's song resolution: reuse the existing catalog show
// verbatim if there's a match (preserving its styling). If there's no match,
// this now auto-creates a real catalog entry (mirroring /api/save-show)
// instead of only embedding transient content in the generated project -
// worship leaders usually send just a title, so the new show gets either
// internet-fetched lyrics or a placeholder slide, clearly flagged as such.
async function resolveSongItem(song: DraftSong, settings: any): Promise<{ item: any; note?: string }> {
  const title = song.title;
  const exists = await checkLocalSongExists(title, '');
  let text = '';
  let fullData: { id: string; data: any } | null = null;
  let note: string | undefined;

  if (exists) {
    text = (await getLocalSongText(title, '')) || '';
    fullData = await getLocalShowData(title, '');
  } else {
    const fetchedLyrics = (await fetchLyricsFromInternet(title, '')) || '';
    const hasLyrics = !!fetchedLyrics.trim();
    text = hasLyrics ? fetchedLyrics : 'Tekst nog toevoegen';

    const cleanName = sanitizeShowName(title);

    if (settings.freeshowPath) {
      try {
        const showsDir = path.join(settings.freeshowPath, 'Shows');
        await fs.mkdir(showsDir, { recursive: true });
        const filePath = path.join(showsDir, `${cleanName}.show`);
        const alreadyExists = await fs.access(filePath).then(() => true).catch(() => false);

        if (!alreadyExists) {
          const categories = await loadFreeshowCategories(settings);
          const { id: categoryId, matched } = resolveSongCategoryId(song.category, categories);
          const showId = crypto.randomBytes(6).toString('hex').substring(0, 11);
          const showObj = createShowObject({ id: showId, data: { name: cleanName, category: categoryId, text } });

          await fs.writeFile(filePath, JSON.stringify([showId, showObj]));
          fullData = { id: showId, data: showObj };

          note = song.category && !matched
            ? `Nieuw lied "${cleanName}" aangemaakt in standaardcategorie (categorie "${song.category}" niet gevonden in FreeShow).`
            : `Nieuw lied "${cleanName}" aangemaakt${matched ? ` in categorie "${song.category}"` : ''} in de catalogus.`;
          if (!hasLyrics) note += ' Tekst nog toevoegen in FreeShow.';
        } else {
          // Collision safety net (e.g. created between the exists-check
          // above and here) - never clobber, just reuse what's on disk.
          fullData = await getLocalShowData(title, '');
        }
      } catch (err) {
        console.error(`[Project Generator] Nieuw lied "${cleanName}" opslaan mislukt:`, err);
        note = `Nieuw lied "${cleanName}" kon niet in de catalogus worden opgeslagen.`;
      }
    } else {
      note = `Lied "${cleanName}" kon niet in de catalogus worden opgeslagen (geen FreeShow-map ingesteld).`;
    }
  }

  return {
    item: {
      id: song.id,
      type: 'song',
      targetSection: song.section,
      fullData: fullData || undefined,
      data: { name: title, category: 'song', text }
    },
    note
  };
}

// Rough approximation of FreeShow's own smart-fit slide splitting (which
// measures actual rendered text against the template's text box in pixels).
// This just word-wraps against the box createShowObject hardcodes for
// scripture slides (see the "1860px"/"865px"/"font-size: 80px" style below),
// and packs as many verses as estimated to fit before starting a new slide,
// instead of always putting exactly one verse per slide.
const SCRIPTURE_BOX_WIDTH = 1860 - 50; // minus 25px padding each side
const SCRIPTURE_BOX_HEIGHT = 865 - 50;
const SCRIPTURE_FONT_SIZE = 80;
const SCRIPTURE_CHARS_PER_LINE = Math.floor(SCRIPTURE_BOX_WIDTH / (SCRIPTURE_FONT_SIZE * 0.5));
const SCRIPTURE_LINES_PER_SLIDE = Math.floor(SCRIPTURE_BOX_HEIGHT / (SCRIPTURE_FONT_SIZE * 1.35));

function estimateLines(verses: { verse: string; text: string }[]): number {
  let lines = 0;
  let currentLineLength = 0;
  for (const v of verses) {
    const words = `${v.verse} ${v.text}`.split(/\s+/);
    for (const word of words) {
      if (!word) continue;
      if (currentLineLength === 0) {
        currentLineLength = word.length;
        lines++;
      } else if (currentLineLength + 1 + word.length <= SCRIPTURE_CHARS_PER_LINE) {
        currentLineLength += 1 + word.length;
      } else {
        lines++;
        currentLineLength = word.length;
      }
    }
  }
  return lines;
}

function groupVersesForSlides(verses: { verse: string; text: string }[]): { verse: string; text: string }[][] {
  const groups: { verse: string; text: string }[][] = [];
  let current: { verse: string; text: string }[] = [];
  for (const v of verses) {
    const proposed = [...current, v];
    if (current.length > 0 && estimateLines(proposed) > SCRIPTURE_LINES_PER_SLIDE) {
      groups.push(current);
      current = [v];
    } else {
      current.push(v);
    }
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

// Mirrors /api/preview's bible resolution exactly (same chunking/text shape)
// so the generated slides look identical to what the manual Builder makes.
async function resolveScriptureItem(scripture: DraftScripture): Promise<any | null> {
  try {
    const verseEnd = scripture.verseEnd ?? scripture.verseStart;
    const bibleRes = await getBibleVerses(scripture.translation, scripture.book, scripture.chapter, scripture.verseStart, verseEnd);
    if (!bibleRes.verses || bibleRes.verses.length === 0) return null;

    const chunks: any[] = groupVersesForSlides(bibleRes.verses);
    const textMap = chunks.map(chunk => chunk.map((v: any) => `${v.verse}. ${v.text}`).join('\n')).join('\n\n');
    const ref = `${scripture.book} ${scripture.chapter}:${scripture.verseStart}${scripture.verseEnd ? '-' + scripture.verseEnd : ''}`;

    return {
      id: scripture.id,
      type: 'bible',
      targetSection: scripture.section,
      refData: {
        collectionId: bibleRes.collectionId,
        metadata: bibleRes.metadata,
        book: bibleRes.bookInfo?.name || scripture.book,
        bookNumber: bibleRes.bookInfo?.number,
        bookAbbr: bibleRes.bookInfo?.abbreviation,
        translationName: bibleRes.translationName,
        chapter: scripture.chapter,
        verses: bibleRes.verses,
        chunks
      },
      data: { name: `${ref} - ${scripture.translation}`, category: 'scripture', text: textMap }
    };
  } catch (err) {
    console.error(`[Project Generator] Bijbeltekst ophalen mislukt voor ${scripture.book} ${scripture.chapter}:${scripture.verseStart}:`, err);
    return null;
  }
}

// Only youtube downloads and image/video attachments can become a real
// FreeShow media item today - PowerPoint attachments and generic links have
// no conversion path in this codebase, so they're surfaced as a note for a
// medewerker to add by hand instead of silently dropped.
//
// layer: 'direct' adds it as a standalone media item in the running order
// (native FreeShow play/pause/stop controls) instead of wrapping it inside
// a "presentation" show, which has no video transport controls at all.
function resolveMediaItem(media: DraftMedia, settings: any): any | null {
  if (!media.filePath) return null;
  const metaType = inferMetaType(media.filePath);
  if (!metaType) return null;
  return {
    id: media.id,
    type: 'media',
    layer: 'direct',
    targetSection: media.section,
    filePath: toFreeShowClientPath(media.filePath, settings.freeshowPath, settings.freeshowClientPath),
    metaType,
    title: media.attachmentName || path.basename(media.filePath)
  };
}

async function findTemplatePath(settings: any): Promise<string> {
  if (settings.defaultTemplate && settings.freeshowProjectPath) {
    const customPath = path.join(settings.freeshowProjectPath, settings.defaultTemplate);
    try {
      await fs.access(customPath);
      return customPath;
    } catch {}
  }
  const fallbacks = [
    path.join(process.cwd(), 'data', 'template.project'),
    '/app/data/template.project'
  ];
  for (const p of fallbacks) {
    try {
      await fs.access(p);
      return p;
    } catch {}
  }
  return '';
}

/**
 * Converts a draft service's accumulated songs/scriptures/media into a real
 * FreeShow .project file and writes it into the configured projects folder,
 * reusing the exact same createFreeShowProject/serializeProject pipeline
 * /api/generate uses for the manual Builder.
 *
 * Overwrite protection: if the project was already generated once and the
 * file on disk no longer matches the hash we wrote last time (i.e. someone
 * edited it directly in FreeShow), this refuses to overwrite it and returns
 * `conflict: true` instead - the caller must retry with `force: true` after
 * explicit confirmation.
 */
export async function generateProjectForDraft(draft: DraftService, opts: { force?: boolean } = {}): Promise<GenerateResult> {
  const settings = getSettings() as any;
  const projectDir = settings.freeshowProjectPath;
  if (!projectDir) {
    return { success: false, message: 'Geen FreeShow projectenmap ingesteld (Instellingen → FreeShow).' };
  }

  const templatePath = await findTemplatePath(settings);
  if (!templatePath) {
    return { success: false, message: 'Geen template bestand gevonden op de server.' };
  }

  const projectName = `Dienst ${draft.serviceDate}`;
  const filename = `${projectName.replace(/[\\/:*?"<>|]/g, '-')}.project`;
  const filePath = path.join(projectDir, filename);

  if (!opts.force && draft.lastGeneratedHash) {
    try {
      const current = await fs.readFile(filePath);
      const currentHash = crypto.createHash('sha256').update(current).digest('hex');
      if (currentHash !== draft.lastGeneratedHash) {
        return { success: false, conflict: true, message: 'Project is buiten de app gewijzigd sinds de laatste update.' };
      }
    } catch {
      // File missing (first generation, or it was deleted) - nothing to conflict with.
    }
  }

  const notes: string[] = [];
  const showsList: any[] = [];

  for (const song of draft.songs) {
    const { item, note } = await resolveSongItem(song, settings);
    showsList.push(item);
    if (note) notes.push(note);
  }
  for (const scripture of draft.scriptures) {
    const item = await resolveScriptureItem(scripture);
    if (item) {
      showsList.push(item);
    } else {
      notes.push(`Bijbeltekst ${scripture.book} ${scripture.chapter}:${scripture.verseStart} kon niet worden opgehaald.`);
    }
  }
  for (const media of draft.media) {
    const item = resolveMediaItem(media, settings);
    if (item) {
      showsList.push(item);
    } else if (media.mediaType !== 'link') {
      notes.push(`Media "${media.attachmentName || media.url}" kon niet automatisch worden toegevoegd, handmatig toevoegen in FreeShow.`);
    }
  }

  const dataJson = await createFreeShowProject(draft.serviceDate, showsList, projectName, templatePath, true);
  const serialized = await serializeProject(dataJson, { draftServiceDate: draft.serviceDate });

  await fs.mkdir(projectDir, { recursive: true });
  await fs.writeFile(filePath, serialized);

  const newHash = crypto.createHash('sha256').update(Buffer.from(serialized)).digest('hex');
  updateGenerationInfo(draft.serviceDate, {
    hash: newHash,
    filePath,
    generatedAt: new Date().toISOString(),
    notes
  });

  return { success: true, message: `Project opgeslagen als ${filename}`, notes };
}
