import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { getSettings } from '@/lib/settingsStore';
import { checkLocalSongExists, getLocalSongText, getLocalShowData, fetchLyricsFromInternet } from '@/lib/songs';
import { getBibleVerses } from '@/lib/bible';
import { createFreeShowProject, serializeProject } from '@/lib/freeshow';
import { toFreeShowClientPath } from '@/lib/freeshowUtils';
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

// Mirrors /api/preview's song resolution: reuse the existing catalog show
// verbatim if there's a match (preserving its styling), fall back to lyrics
// fetched from the internet, or an empty placeholder if neither is found -
// auto-creating a brand new catalog entry is a later phase, not this one.
async function resolveSongItem(song: DraftSong): Promise<any> {
  const title = song.title;
  const exists = await checkLocalSongExists(title, '');
  let text = '';
  let fullData: { id: string; data: any } | null = null;

  if (exists) {
    text = (await getLocalSongText(title, '')) || '';
    fullData = await getLocalShowData(title, '');
  } else {
    text = (await fetchLyricsFromInternet(title, '')) || '';
  }

  return {
    id: song.id,
    type: 'song',
    targetSection: song.section,
    fullData: fullData || undefined,
    data: { name: title, category: 'song', text }
  };
}

// Mirrors /api/preview's bible resolution exactly (same chunking/text shape)
// so the generated slides look identical to what the manual Builder makes.
async function resolveScriptureItem(scripture: DraftScripture): Promise<any | null> {
  try {
    const verseEnd = scripture.verseEnd ?? scripture.verseStart;
    const bibleRes = await getBibleVerses(scripture.translation, scripture.book, scripture.chapter, scripture.verseStart, verseEnd);
    if (!bibleRes.verses || bibleRes.verses.length === 0) return null;

    const chunks: any[] = bibleRes.verses.map((v: any) => [v]);
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
        chapter: scripture.chapter,
        verses: bibleRes.verses,
        chunks,
        versesPerSlide: 1
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
    showsList.push(await resolveSongItem(song));
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
