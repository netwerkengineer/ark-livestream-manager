import { XMLParser } from 'fast-xml-parser';
import fs from 'fs/promises';
import path from 'path';
import { getSettings } from '@/lib/settingsStore';
import { foldDiacritics } from '@/lib/freeshowUtils';

export interface BibleVerse {
  book: string;
  chapter: number;
  verse: number;
  text: string;
}

export async function getBibleVerses(translation: string, bookName: string, chapterNum: number, verseStart: number, verseEnd: number): Promise<{
  verses: { verse: string, text: string }[],
  collectionId?: string,
  metadata?: any,
  bookInfo?: { number: string, name: string, abbreviation: string },
  translationName?: string
}> {
  let biblesDir = process.env.FREESHOW_BIBLES_DIR || path.join(process.cwd(), 'database', 'bibles');
  
  try {
    const settings = getSettings() as any;
    if (settings.freeshowPath) {
      biblesDir = path.join(settings.freeshowPath, 'Bibles');
    }
  } catch(e) {}

  try {
    const files = await fs.readdir(biblesDir);
    const fsbFile = files.find(f => f.includes(`(${translation})`) && f.endsWith('.fsb'));
    
    if (!fsbFile) return { verses: [] };

    const content = await fs.readFile(path.join(biblesDir, fsbFile), 'utf-8');
    const rawData = JSON.parse(content);
    const collectionId = Array.isArray(rawData) ? rawData[0] : null;
    const bibleData = Array.isArray(rawData) ? rawData[1] : rawData;

    const books = bibleData.books || [];
    const normalizedBookName = foldDiacritics(bookName.toLowerCase());
    const bookIndex = books.findIndex((b: any) =>
      foldDiacritics(b.name.toLowerCase()) === normalizedBookName ||
      b.number === bookName
    );
    const book = bookIndex !== -1 ? books[bookIndex] : undefined;
    // The raw .fsb data has no book.number field at all - FreeShow itself
    // derives it from the book's 1-indexed position in the books array
    // (confirmed against a real FreeShow-authored show: Jozua, the 6th
    // book, had reference.data.book === "6").
    const bookInfo = book ? {
      number: String(bookIndex + 1),
      name: book.name,
      abbreviation: book.name.substring(0, 3) // Fallback abbreviation
    } : undefined;

    const translationName = fsbFile.replace(/\.fsb$/i, '');

    if (!book) return { verses: [], collectionId, metadata: bibleData.metadata, bookInfo, translationName };

    const chapter = (book.chapters || []).find((c: any) => parseInt(c.number) === chapterNum);
    if (!chapter) return { verses: [], collectionId, metadata: bibleData.metadata, bookInfo, translationName };

    const result = (chapter.verses || []).filter((v: any) => {
      const vn = parseInt(v.number);
      return vn >= verseStart && vn <= verseEnd;
    }).map((v: any) => ({
      verse: v.number,
      text: v.text
    }));

    return { verses: result, collectionId, metadata: bibleData.metadata, bookInfo, translationName };
  } catch (err) {
    console.error("Bible read error:", err);
    return { verses: [] };
  }
}
