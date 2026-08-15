import imaps from 'imap-simple';
import { simpleParser } from 'mailparser';
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { getSettings } from '@/lib/settingsStore';
import { parseServiceEmail, ParsedMedia } from '@/lib/emailParser';
import { mergeParsedEmailIntoDraft, DraftService } from '@/lib/draftServicesStore';
import { generateProjectForDraft } from '@/lib/draftProjectGenerator';

const execFilePromise = promisify(execFile);
const ATTACHMENTS_DIR = path.join(process.cwd(), 'data', 'emailAttachments');
const YOUTUBE_URL_RE = /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i;

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

// Downloads a YouTube link mentioned in a service-planning email so it can
// be embedded as real media in the generated FreeShow project. Uses
// execFile (argument array, no shell) rather than a shell string - the URL
// comes from an email, which is less trusted input than the existing
// (admin-triggered) yt-download route this mirrors.
async function downloadYoutubeVideo(url: string, dir: string): Promise<{ filePath: string; title: string } | null> {
  if (!YOUTUBE_URL_RE.test(url)) return null;
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const { stdout: metadataJson } = await execFilePromise('yt-dlp', ['--dump-json', '--skip-download', url]);
    const metadata = JSON.parse(metadataJson);
    const videoTitle = (metadata.title || 'video').replace(/[\\/:*?"<>|]/g, '-').trim();
    const fileName = `${videoTitle}.mp4`;
    const finalPath = path.join(dir, fileName);

    await execFilePromise('yt-dlp', [
      '-f', 'bestvideo[height<=1080]+bestaudio/best',
      '--merge-output-format', 'mp4',
      '-o', finalPath,
      url
    ]);

    return { filePath: finalPath, title: videoTitle };
  } catch (err) {
    console.error(`[Email Sync] YouTube-download mislukt voor ${url}:`, err);
    return null;
  }
}

async function resolveYoutubeDownloads(items: ParsedMedia[], dir: string) {
  for (const item of items) {
    if (item.mediaType !== 'youtube' || !item.url) continue;
    const result = await downloadYoutubeVideo(item.url, dir);
    if (result) {
      item.filePath = result.filePath;
    }
  }
}

interface RawFetchedMessage {
  parts: Record<string, string>;
  attributes: any;
}

// imap-simple's own search+fetch combination (connection.search / getParts)
// was unreliable in testing against Gmail: it consistently returned zero
// body parts even for messages confirmed present via raw IMAP protocol
// testing. This drives node-imap's lower-level fetch API directly instead -
// the same primitive imap-simple itself is built on - which is the standard,
// well-documented way to read message bodies/attachments.
function rawFetch(imap: any, source: any, options: any): Promise<RawFetchedMessage[]> {
  return new Promise((resolve, reject) => {
    const messages: RawFetchedMessage[] = [];
    const f = imap.fetch(source, options);
    f.on('message', (msg: any) => {
      const parts: Record<string, string> = {};
      let attributes: any = null;
      msg.on('body', (stream: any, info: any) => {
        let buffer = '';
        stream.on('data', (chunk: Buffer) => { buffer += chunk.toString('utf8'); });
        stream.once('end', () => { parts[info.which] = buffer; });
      });
      msg.once('attributes', (attrs: any) => { attributes = attrs; });
      msg.once('end', () => { messages.push({ parts, attributes }); });
    });
    f.once('error', reject);
    f.once('end', () => resolve(messages));
  });
}

// node-imap's raw fetch() has no markSeen convenience option - that's an
// imap-simple-only wrapper that silently does nothing if passed here
// (unrecognized object keys are just ignored). Without this, a message is
// never actually marked \Seen, so it gets reprocessed and re-merged on
// every future sync.
function markSeen(imap: any, uid: number): Promise<void> {
  return new Promise((resolve, reject) => {
    imap.addFlags(uid, '\\Seen', (err: any) => {
      if (err) reject(err); else resolve();
    });
  });
}

interface AttachmentPart {
  partID: string;
  filename: string;
  encoding: string;
}

// Walks a BODYSTRUCTURE (node-imap's parsed array form) to find parts with a
// filename, i.e. real attachments - multipart/mixed nests as arrays, leaf
// parts are objects with disposition/params.
function findAttachmentParts(struct: any, parts: AttachmentPart[] = []): AttachmentPart[] {
  if (!Array.isArray(struct)) return parts;
  for (const part of struct) {
    if (Array.isArray(part)) {
      findAttachmentParts(part, parts);
      continue;
    }
    const filename = part?.disposition?.params?.filename || part?.params?.name;
    if (filename && part.partID) {
      parts.push({ partID: part.partID, filename, encoding: (part.encoding || '7bit').toLowerCase() });
    }
  }
  return parts;
}

function decodeAttachmentBody(body: string, encoding: string): Buffer {
  if (encoding === 'base64') return Buffer.from(body, 'base64');
  return Buffer.from(body, 'utf-8');
}

async function fetchAttachments(imap: any, uid: number, struct: any): Promise<{ filename: string; content: Buffer }[]> {
  const attachmentParts = findAttachmentParts(struct);
  if (attachmentParts.length === 0) return [];

  const fetched = await rawFetch(imap, [uid], { bodies: attachmentParts.map(p => p.partID) });
  if (fetched.length === 0) return [];

  const attachments: { filename: string; content: Buffer }[] = [];
  for (const ap of attachmentParts) {
    const body = fetched[0].parts[ap.partID];
    if (body) {
      attachments.push({ filename: ap.filename, content: decodeAttachmentBody(body, ap.encoding) });
    }
  }
  return attachments;
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
    const imap = (connection as any).imap;

    // For a shared/existing mailbox, restrict the IMAP-side search to
    // subjects containing the configured keyword so unrelated mail is never
    // fetched or marked as read by this sync - only matching messages are
    // touched at all. Leave the keyword empty to check every unread mail.
    const subjectKeyword: string = (settings.emailSubjectKeyword ?? 'Liturgie').trim();
    const searchCriteria: any[] = subjectKeyword
      ? ['UNSEEN', ['SUBJECT', subjectKeyword]]
      : ['UNSEEN'];
    // Search only for matching UIDs here - body/attachment content is fetched
    // separately below via rawFetch(), see its comment for why.
    const uids: number[] = await connection.search(searchCriteria, { bodies: [] })
      .then((results: any[]) => results.map(r => r.attributes.uid));
    console.log(`[Email Sync] ${uids.length} bericht(en) gevonden voor criteria ${JSON.stringify(searchCriteria)}.`);

    for (const uid of uids) {
      const fetched = await rawFetch(imap, [uid], { bodies: ['HEADER', 'TEXT'], struct: true });
      if (fetched.length === 0) {
        console.error(`[Email Sync] Kon bericht UID ${uid} niet ophalen, wordt overgeslagen.`);
        continue;
      }
      const { parts, attributes } = fetched[0];
      const textBody = parts['TEXT'];
      if (!textBody) {
        console.error(`[Email Sync] Geen tekstdeel in bericht UID ${uid}, onderdelen: ${JSON.stringify(Object.keys(parts))}`);
        continue;
      }

      // Mark seen now that the message has been successfully fetched, so a
      // failure further down (attachment fetch, store write) can't leave it
      // permanently stuck as unread-and-unprocessable, but a message we
      // never even got the text for is left unseen for a retry next sync.
      try {
        await markSeen(imap, uid);
      } catch (seenErr) {
        console.error(`[Email Sync] Kon bericht UID ${uid} niet als gelezen markeren:`, seenErr);
      }

      const rawMessage = `${parts['HEADER'] || ''}\r\n${textBody}`;
      const parsedMail = await simpleParser(rawMessage);
      const content = parsedMail.text || textBody;
      const messageId = parsedMail.messageId || `${uid}-${Date.now()}`;
      const subject = parsedMail.subject || '(geen onderwerp)';
      const receivedAt = (parsedMail.date || new Date()).toISOString();

      const parsed = parseServiceEmail(content);

      let attachments: { filename: string; content: Buffer }[] = [];
      if (attributes?.struct) {
        try {
          attachments = await fetchAttachments(imap, uid, attributes.struct);
        } catch (attErr) {
          console.error('[Email Sync] Bijlagen ophalen mislukt:', attErr);
        }
      }
      const saved = saveAttachments(messageId, attachments);
      const mediaItems = parsed.items.filter((i): i is ParsedMedia => i.type === 'media');
      resolveAttachmentPaths(mediaItems, saved);
      await resolveYoutubeDownloads(mediaItems, path.join(ATTACHMENTS_DIR, sanitizeFilename(messageId)));

      const draft = mergeParsedEmailIntoDraft(parsed, {
        messageId,
        subject,
        receivedAt,
        excerpt: content.slice(0, 500)
      });

      if (draft) {
        touchedDrafts.set(draft.serviceDate, draft);
        // Best-effort: keep the FreeShow project in sync with every new
        // mail automatically. A conflict (someone edited it directly in
        // FreeShow) is left for a medewerker to resolve in the review tab
        // rather than force-overwritten here.
        try {
          const result = await generateProjectForDraft(draft);
          if (!result.success && !result.conflict) {
            console.error(`[Email Sync] Project genereren voor ${draft.serviceDate} mislukt: ${result.message}`);
          }
        } catch (genErr) {
          console.error(`[Email Sync] Project genereren voor ${draft.serviceDate} gaf een fout:`, genErr);
        }
      }
    }

    connection.end();
    return Array.from(touchedDrafts.values());
  } catch (error) {
    console.error('IMAP Error:', error);
    throw error;
  }
}
