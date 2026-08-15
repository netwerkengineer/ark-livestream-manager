import { NextRequest, NextResponse } from 'next/server';
import { checkLocalSongExists, fetchLyricsFromInternet, getLocalSongText, getLocalShowData } from '@/lib/songs';
import { getBibleVerses } from '@/lib/bible';
import { isAuthorized } from '@/lib/authHelper';

export async function POST(req: NextRequest) {
  try {
    const authSession = await isAuthorized(req);
    if (!authSession) {
      return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
    }

    const { items } = await req.json();
    const results = [];

    for (const item of items) {
      if (item.type === 'song') {
        const title = item.title || '';
        const artist = item.artist || '';
        
        const localExists = await checkLocalSongExists(title, artist);
        if (localExists) {
          const localText = await getLocalSongText(title, artist);
          const fullData = await getLocalShowData(title, artist);
          results.push({ 
            ...item, 
            status: 'local', 
            text: localText || 'Bestand gevonden, maar geen tekst kunnen inlezen.',
            fullData: fullData 
          });
        } else {
          // Attempt internet fetch
          const lyrics = await fetchLyricsFromInternet(title, artist);
          if (lyrics) {
            results.push({ ...item, status: 'internet', text: lyrics });
          } else {
            results.push({ ...item, status: 'missing', text: '' });
          }
        }
      } else if (item.type === 'bible') {
        try {
          const match = item.ref.match(/(.+)\s+(\d+):(\d+)(?:-(\d+))?/);
          if (match) {
            const book = match[1].trim();
            const chap = parseInt(match[2]);
            const verse1 = parseInt(match[3]);
            const verse2 = match[4] ? parseInt(match[4]) : verse1;
            
            const bibleRes = await getBibleVerses(item.translation, book, chap, verse1, verse2);
            if (bibleRes.verses && bibleRes.verses.length > 0) {
              const perSlide = item.versesPerSlide || 1;
              const chunks = [];
              for (let i = 0; i < bibleRes.verses.length; i += perSlide) {
                chunks.push(bibleRes.verses.slice(i, i + perSlide));
              }

              const textMap = chunks.map(chunk => 
                chunk.map(v => `${v.verse}. ${v.text}`).join('\n')
              ).join('\n\n');

              results.push({ 
                ...item, 
                status: 'local', 
                text: textMap,
                bibleData: {
                  collectionId: bibleRes.collectionId,
                  metadata: bibleRes.metadata,
                  book: bibleRes.bookInfo?.name || book,
                  bookNumber: bibleRes.bookInfo?.number,
                  bookAbbr: bibleRes.bookInfo?.abbreviation,
                  translationName: bibleRes.translationName,
                  chapter: chap,
                  verses: bibleRes.verses,
                  chunks: chunks,
                  versesPerSlide: perSlide
                }
              });
            } else {
              results.push({ ...item, status: 'missing', text: '' });
            }
          } else {
            results.push({ ...item, status: 'missing', text: '', error: 'Ongeldig referentie formaat' });
          }
        } catch (e: any) {
          results.push({ ...item, status: 'missing', text: '', error: e.message });
        }
      } else {
        // Passthrough for other item types (media, section, youtube, etc.)
        results.push({ ...item, status: 'passthrough', text: '' });
      }
    }

    return NextResponse.json({ success: true, items: results });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
