import fs from 'fs/promises';
import path from 'path';

// Extracts plain text from a lyrics attachment (.txt/.pdf/.docx) so a song
// mailed in as a file can be treated the same as one typed straight into
// the email body. Returns '' (rather than throwing) on unsupported types or
// extraction failures - the caller falls back to internet lookup/placeholder
// text, same as when no attachment was supplied at all.
export async function extractTextFromDocument(filePath: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();

  try {
    if (ext === '.txt') {
      return await fs.readFile(filePath, 'utf-8');
    }

    if (ext === '.pdf') {
      const { PDFParse } = await import('pdf-parse');
      const data = await fs.readFile(filePath);
      const parser = new PDFParse({ data });
      try {
        const result = await parser.getText();
        return result.text || '';
      } finally {
        await parser.destroy();
      }
    }

    if (ext === '.docx') {
      const mammoth = await import('mammoth');
      const buffer = await fs.readFile(filePath);
      const result = await mammoth.extractRawText({ buffer });
      return result.value || '';
    }

    return '';
  } catch (err) {
    console.error(`[Document Text] Kon tekst niet uitlezen uit ${filePath}:`, err);
    return '';
  }
}
