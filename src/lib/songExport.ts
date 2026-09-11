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
// attachment gets, with or without a PDF alongside it.
export function buildSongTextFile(song: DraftSong): ExportedFile {
  const lines = [song.artist ? `${song.title} - ${song.artist}` : song.title, ''];
  lines.push(song.lyricsText || '(geen songtekst toegevoegd)');
  if (song.chordsText) {
    lines.push('', '--- Akkoorden ---', song.chordsText);
  }
  return {
    filename: `${sanitizeFilename(song.title)}.txt`,
    content: Buffer.from(lines.join('\n'), 'utf-8')
  };
}

// One page per song - title, artist, lyrics, and (if present) a monospace
// chords block. Pure-JS via pdfkit, no headless browser, so it runs fine in
// the existing self-hosted Docker setup with no extra system dependency.
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

      if (song.chordsText) {
        doc.moveDown();
        doc.fontSize(12).font('Helvetica-Bold').text('Akkoorden');
        doc.moveDown(0.3);
        doc.font('Courier').fontSize(11).text(song.chordsText, { lineGap: 2 });
      }

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
