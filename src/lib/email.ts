import imaps from 'imap-simple';
import { simpleParser } from 'mailparser';
import fs from 'fs';
import path from 'path';
import { getSettings } from '@/lib/settingsStore';
import { parseServiceEmail, ParsedMedia } from '@/lib/emailParser';
import { mergeParsedEmailIntoDraft, DraftService } from '@/lib/draftServicesStore';

const ATTACHMENTS_DIR = path.join(process.cwd(), 'data', 'emailAttachments');

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_.-]/g, '_');
}

function saveAttachments(messageId: string, attachments: { filename?: string; content: Buffer }[]): { filename: string; path: string }[] {
  if (attachments.length === 0) return [];
  const dir = path.join(ATTACHMENTS_DIR, sanitizeFilename(messageId || Date.now().toString()));
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const saved: { filename: string; path: string }[] = [];
  for (const att of attachments) {
    if (!att.filename) continue;
    const safeName = sanitizeFilename(att.filename);
    const filePath = path.join(dir, safeName);
    fs.writeFileSync(filePath, att.content);
    saved.push({ filename: att.filename, path: filePath });
  }
  return saved;
}

// Matches a "(bijlage: naam)" reference from the email body against the
// attachments that were actually saved, so the draft can reference the
// real file instead of just the filename someone typed in the text.
function resolveAttachmentPaths(items: ParsedMedia[], saved: { filename: string; path: string }[]) {
  for (const item of items) {
    if (item.mediaType !== 'attachment' || !item.attachmentName) continue;
    const wanted = item.attachmentName.trim().toLowerCase();
    const match = saved.find(s => s.filename.toLowerCase() === wanted)
      || saved.find(s => s.filename.toLowerCase().includes(wanted) || wanted.includes(s.filename.toLowerCase()));
    if (match) {
      item.filePath = match.path;
    }
  }
}

/**
 * Polls the configured IMAP inbox for unread service-planning emails,
 * parses each one with the rule-based section parser, and merges the
 * result into the draft-services store (data/draftServices.json).
 * Nothing here touches FreeShow itself - that only happens once a
 * medewerker reviews and generates/updates a project from the drafts tab.
 */
export async function checkEmailsForProjects(): Promise<DraftService[]> {
  const settings = getSettings() as any;
  const imapHost = settings.imapHost || process.env.IMAP_HOST || 'imap.gmail.com';
  const config = {
    imap: {
      user: settings.imapUser || process.env.IMAP_USER || '',
      password: settings.imapPass || process.env.IMAP_PASSWORD || '',
      host: imapHost,
      port: Number(settings.imapPort) || Number(process.env.IMAP_PORT) || 993,
      tls: true,
      // node-imap doesn't set SNI by default; without it some IMAP hosts
      // (Gmail included) return a fallback/self-signed cert instead of the
      // real one, and the TLS handshake fails with "self-signed certificate".
      tlsOptions: { servername: imapHost },
      authTimeout: 3000
    }
  };

  if (!config.imap.user || !config.imap.password) {
    throw new Error('IMAP-gegevens zijn niet geconfigureerd.');
  }

  const touchedDrafts = new Map<string, DraftService>();

  try {
    const connection = await imaps.connect(config);
    await connection.openBox('INBOX');

    // For a shared/existing mailbox, restrict the IMAP-side search to
    // subjects containing the configured keyword so unrelated mail is never
    // fetched or marked as read by this sync - only matching messages are
    // touched at all. Leave the keyword empty to check every unread mail.
    const subjectKeyword: string = (settings.emailSubjectKeyword ?? 'Liturgie').trim();
    const searchCriteria: any[] = subjectKeyword
      ? ['UNSEEN', ['SUBJECT', subjectKeyword]]
      : ['UNSEEN'];
    // Fetch the full raw message (bodies: ['']) so mailparser can extract attachments,
    // not just the text part.
    const fetchOptions = { bodies: [''], markSeen: true, struct: true };
    const results = await connection.search(searchCriteria, fetchOptions);
    console.log(`[Email Sync] ${results.length} bericht(en) gevonden voor criteria ${JSON.stringify(searchCriteria)}.`);

    for (const res of results) {
      const allParts = imaps.getParts(res.parts as any);
      console.log(`[Email Sync] Onderdelen in bericht: ${JSON.stringify(allParts.map((p: any) => p.which))}`);
      const fullPart = allParts.find((part: any) => part.which === '' || part.which === 'TEXT');
      if (!fullPart) {
        console.error('[Email Sync] Geen bruikbaar berichtdeel gevonden, wordt overgeslagen.');
        continue;
      }

      const parsedMail = await simpleParser(fullPart.body);
      const content = parsedMail.text || '';
      const messageId = parsedMail.messageId || `${Date.now()}`;
      const subject = parsedMail.subject || '(geen onderwerp)';
      const receivedAt = (parsedMail.date || new Date()).toISOString();

      const parsed = parseServiceEmail(content);

      const saved = saveAttachments(messageId, (parsedMail.attachments || []).map(a => ({ filename: a.filename, content: a.content })));
      resolveAttachmentPaths(parsed.items.filter((i): i is ParsedMedia => i.type === 'media'), saved);

      const draft = mergeParsedEmailIntoDraft(parsed, {
        messageId,
        subject,
        receivedAt,
        excerpt: content.slice(0, 500)
      });

      if (draft) {
        touchedDrafts.set(draft.serviceDate, draft);
      }
    }

    connection.end();
    return Array.from(touchedDrafts.values());
  } catch (error) {
    console.error('IMAP Error:', error);
    throw error;
  }
}
