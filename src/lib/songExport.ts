import PDFDocument from 'pdfkit';
import type { DraftSong } from './draftServicesStore';

export interface ExportedFile {
  filename: string;
  content: Buffer;
}

export function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_.\- ]/g, '_').trim() || 'lied';
}

// Always generated, no dependency - the plain-text fallback every song
// attachment gets, with or without a PDF alongside it. Lyrics only - chords
// are their own independently-toggleable attachment (buildChordsTextFile,
// or the band's own uploaded chord chart), not embedded here.
export function buildSongTextFile(song: DraftSong): ExportedFile {
  const lines = [song.artist ? `${song.title} - ${song.artist}` : song.title, ''];
  lines.push(song.lyricsText || '(geen songtekst toegevoegd)');
  return {
    filename: `${sanitizeFilename(song.title)}.txt`,
    content: Buffer.from(lines.join('\n'), 'utf-8')
  };
}

// A chords-only .txt attachment generated from free-text chords - used only
// when the song has no uploaded chord-chart file (that gets attached
// verbatim instead, under its own original extension).
export function buildChordsTextFile(song: DraftSong): ExportedFile {
  const lines = [song.artist ? `${song.title} - ${song.artist}` : song.title, '', song.chordsText || ''];
  return {
    filename: `${sanitizeFilename(song.title)} (akkoorden).txt`,
    content: Buffer.from(lines.join('\n'), 'utf-8')
  };
}

// One page per song - title, artist, and lyrics. Pure-JS via pdfkit, no
// headless browser, so it runs fine in the existing self-hosted Docker setup
// with no extra system dependency. Lyrics only, same as buildSongTextFile -
// chords are their own attachment.
export function buildSongPdf(song: DraftSong): Promise<ExportedFile> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50 });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => {
        resolve({ filename: `${sanitizeFilename(song.title)}.pdf`, content: Buffer.concat(chunks) });
      });
      doc.on('error', reject);

      doc.fontSize(20).font('Helvetica-Bold').text(song.title);
      if (song.artist) {
        doc.fontSize(12).font('Helvetica').fillColor('#555').text(song.artist);
      }
      doc.moveDown();

      doc.fillColor('#000').fontSize(12).font('Helvetica').text(song.lyricsText || '(geen songtekst toegevoegd)', {
        lineGap: 4
      });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

// A short, WhatsApp-friendly plain-text summary: date, songs in order, no
// full lyrics (too long for a chat message - the email carries those).
export function formatSetlistSummary(serviceDateLabel: string, songs: DraftSong[]): string {
  const lines = [`Setlist ${serviceDateLabel}:`, ''];
  songs.forEach((s, i) => {
    lines.push(`${i + 1}. ${s.title}${s.artist ? ` - ${s.artist}` : ''}`);
  });
  return lines.join('\n');
}
