import imaps from 'imap-simple';
import { simpleParser } from 'mailparser';
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { getSettings } from '@/lib/settingsStore';
import { parseServiceEmail, ParsedMedia, ParsedSong } from '@/lib/emailParser';
import { mergeParsedEmailIntoDraft, DraftService } from '@/lib/draftServicesStore';
import { generateProjectForDraft } from '@/lib/draftProjectGenerator';
import { extractTextFromDocument } from '@/lib/documentText';
import { logActivity } from '@/lib/activityLog';

const execFilePromise = promisify(execFile);
const YOUTUBE_URL_RE = /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i;

// Turns a rich-text (HTML) mail body into plain text with real line breaks,
// used instead of mailparser's own .text field whenever HTML is present.
// Gmail's default (non-"platte tekst") compose mode sends worship-leader
// mails that look fine to a human but, once boiled down to plain text by
// Gmail itself or by mailparser's generic HTML fallback, can lose every
// line break between list items (a whole "Liederen:" block collapsing onto
// one line) and turn bold text into "*word*" - both silently break every
// line-based pattern in parseServiceEmail(). Forcing every block-level tag
// to become its own newline *before* stripping tags sidesteps that,
// regardless of how the sender formatted the mail.
export function htmlToPlainText(html: string): string {
  return html
    // Gmail commonly emits "<br clear=\"all\">" (a long-standing quirk) for
    // a manual line break within a paragraph, not just a bare "<br>" - the
    // stricter pattern this used to have silently deleted that whole tag
    // (falling through to the generic tag-stripper below) instead of
    // inserting a newline, flattening exactly the lines it appeared on.
    .replace(/<br\b[^>]*>/gi, '\n')
    // A real HTML bullet (<li>) carries no literal "-" in its text content
    // at all - the bullet mark is pure CSS list-style. Without mapping it
    // to this app's own "- item" convention, every song a worship leader
    // adds via an actual bulleted list (very natural to create by pasting
    // or using the toolbar in a rich-text compose window) would silently
    // fail every "- Titel" pattern downstream.
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/li>/gi, '')
    .replace(/<\/?(div|p|tr|table|ul|ol|h[1-6])\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/gi, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Mailboxes checked on every sync, in order. Gmail's spam folder keeps this
// exact English IMAP name regardless of the account's display language -
// a legitimate liturgie-mail can land here by mistake (spam classification
// is provider-side, outside this app's control), so it's worth a safety-net
// scan alongside the inbox rather than only ever checking INBOX.
const MAILBOXES_TO_SCAN = ['INBOX', '[Gmail]/Spam'];

// Builds an IMAP search criterion matching any of the given subject
// keywords, e.g. ['Liturgie', 'Zondagsdienst'] ->
// ['OR', ['SUBJECT', 'Liturgie'], ['SUBJECT', 'Zondagsdienst']] - node-imap's
// OR takes exactly two operands, so 3+ keywords nest left-to-right.
function buildSubjectCriteria(keywords: string[]): any[] {
  return keywords.slice(1).reduce(
    (acc: any[], kw: string) => ['OR', acc, ['SUBJECT', kw]],
    ['SUBJECT', keywords[0]]
  );
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_.-]/g, '_');
}

// Attachments/downloaded video must live under FreeShow's own media folder
// (settings.freeshowMediaPath) - the same directory the manual upload flow
// (/api/upload) writes into - because FreeShow runs on a separate machine
// (the Beamer PC) and can only resolve paths inside its own media root.
// Saving into this app's internal data/ folder produces a path FreeShow
// can't read at all, which renders as a black slide.
function getMediaStagingDir(settings: any, messageId: string): string | null {
  if (!settings.freeshowMediaPath) return null;
  return path.join(settings.freeshowMediaPath, 'email-import', sanitizeFilename(messageId || Date.now().toString()));
}

function saveAttachments(dir: string | null, attachments: { filename?: string; content: Buffer }[]): { filename: string; path: string }[] {
  if (!dir || attachments.length === 0) return [];
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

// Same matching as resolveAttachmentPaths, for a song's inline "(bijlage:
// naam)" lyrics reference instead of a Media-block attachment.
function resolveSongLyricsAttachments(items: ParsedSong[], saved: { filename: string; path: string }[]) {
  for (const item of items) {
    if (!item.lyricsAttachmentName) continue;
    const wanted = item.lyricsAttachmentName.trim().toLowerCase();
    const match = saved.find(s => s.filename.toLowerCase() === wanted)
      || saved.find(s => s.filename.toLowerCase().includes(wanted) || wanted.includes(s.filename.toLowerCase()));
    if (match) {
      item.lyricsFilePath = match.path;
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

    // AV1 uitsluiten: FreeShow (Electron/Chromium) speelt AV1 niet
    // betrouwbaar af op de output - zie src/app/api/yt-download/route.ts
    // voor dezelfde fix en de uitleg erachter.
    await execFilePromise('yt-dlp', [
      '-f', 'bestvideo[height<=1080][vcodec!*=av01]+bestaudio/bestvideo[height<=1080]+bestaudio/best',
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

async function resolveYoutubeDownloads(items: ParsedMedia[], dir: string | null) {
  if (!dir) return;
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

  // For a shared/existing mailbox, restrict the IMAP-side search to subjects
  // containing one of the configured keywords (comma-separated - defaults to
  // "Liturgie,Zondagsdienst") so unrelated mail is never fetched or marked as
  // read by this sync - only matching messages are touched at all. Leave
  // empty to check every unread mail.
  const subjectKeywords: string[] = (settings.emailSubjectKeyword ?? 'Liturgie,Zondagsdienst')
    .split(',')
    .map((k: string) => k.trim())
    .filter(Boolean);
  const searchCriteria: any[] = subjectKeywords.length
    ? ['UNSEEN', buildSubjectCriteria(subjectKeywords)]
    : ['UNSEEN'];

  try {
    const connection = await imaps.connect(config);
    const imap = (connection as any).imap;

    for (const mailbox of MAILBOXES_TO_SCAN) {
      try {
        await connection.openBox(mailbox);
      } catch (boxErr: any) {
        console.error(`[Email Sync] Kon mailbox "${mailbox}" niet openen, wordt overgeslagen: ${boxErr?.message || boxErr}`);
        continue;
      }

      // Search only for matching UIDs here - body/attachment content is fetched
      // separately below via rawFetch(), see its comment for why.
      const uids: number[] = await connection.search(searchCriteria, { bodies: [] })
        .then((results: any[]) => results.map(r => r.attributes.uid));
      console.log(`[Email Sync] [${mailbox}] ${uids.length} bericht(en) gevonden voor criteria ${JSON.stringify(searchCriteria)}.`);

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
        // Prefer converting the HTML ourselves over parsedMail.text: Gmail's
        // rich-text compose mode (the default, non-"platte tekst" one) can
        // generate a text/plain alternative - or feed mailparser's own HTML
        // fallback - that loses line breaks between list items. Converting
        // from the fuller HTML source ourselves, with every block-level tag
        // forced onto its own line, is what actually matches how the sender
        // saw it on screen.
        const content = parsedMail.html ? htmlToPlainText(parsedMail.html) : (parsedMail.text || textBody);
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
        const stagingDir = getMediaStagingDir(settings, messageId);
        if (!stagingDir) {
          console.error('[Email Sync] Geen freeshowMediaPath ingesteld - bijlagen/YouTube-video worden niet opgeslagen.');
        }
        const saved = saveAttachments(stagingDir, attachments);
        const mediaItems = parsed.items.filter((i): i is ParsedMedia => i.type === 'media');
        resolveAttachmentPaths(mediaItems, saved);
        await resolveYoutubeDownloads(mediaItems, stagingDir);

        const songItems = parsed.items.filter((i): i is ParsedSong => i.type === 'song');
        resolveSongLyricsAttachments(songItems, saved);
        for (const song of songItems) {
          // Inline [Tekst]...[/Tekst] body text wins if a mail somehow supplied
          // both - the attachment is only read when there's nothing already.
          if (!song.lyricsText && song.lyricsFilePath) {
            const extracted = await extractTextFromDocument(song.lyricsFilePath);
            if (extracted.trim()) {
              song.lyricsText = extracted;
            } else {
              console.error(`[Email Sync] Kon geen tekst uit bijlage "${song.lyricsAttachmentName}" halen voor lied "${song.title}".`);
            }
          }
        }

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
    } // end mailbox loop

    connection.end();
    return Array.from(touchedDrafts.values());
  } catch (error) {
    console.error('IMAP Error:', error);
    throw error;
  }
}

/**
 * Background counterpart to the manual "Check nu" button - polls the same
 * checkEmailsForProjects() on an interval so new liturgie-mails get picked
 * up without a medewerker needing to open the drafts tab. Mirrors
 * initThumbnailSync()'s startup-then-interval shape. Missing/invalid IMAP
 * settings just log and retry next tick, same as an unconfigured YouTube
 * connection does elsewhere in this app.
 */
function runEmailCheck() {
  checkEmailsForProjects()
    .then(drafts => {
      if (drafts.length > 0) {
        logActivity('sync', `E-mail-sync: ${drafts.length} dienst(en) bijgewerkt (${drafts.map(d => d.serviceDate).join(', ')})`);
      }
    })
    .catch(err => {
      console.error('[Email Sync] Check error:', err.message || err);
      logActivity('error', `E-mail-sync mislukt: ${err.message || err}`);
    });
}

export function initEmailSync() {
  console.log('[Email Sync] Initializing background email sync task...');
  runEmailCheck();

  setInterval(() => {
    console.log('[Email Sync] Running scheduled background check...');
    runEmailCheck();
  }, 10 * 60 * 1000);
}
