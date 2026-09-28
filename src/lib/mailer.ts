import nodemailer from 'nodemailer';
import fs from 'fs';
import path from 'path';
import { getSettings } from './settingsStore';
import { logActivity } from './activityLog';

export interface MailAttachment {
  filename: string;
  content: Buffer;
}

export interface SendMailOptions {
  to: string[];
  subject: string;
  bodyText: string;
  attachments?: MailAttachment[];
  replyTo?: string[];
}

export interface SendMailResult {
  success: boolean;
  error?: string;
}

// Outbound mail, separate from email.ts (which only ever receives via
// IMAP). Recipients go in bcc rather than to/cc so a small church team's
// personal addresses aren't exposed to every other recipient - the "to"
// field is filled with the sender's own address instead, which every SMTP
// server accepts.
export async function sendSetlistEmail(opts: SendMailOptions): Promise<SendMailResult> {
  const settings = getSettings() as any;
  const { smtpHost, smtpPort, smtpUser, smtpPass, smtpSecure, smtpFromName, smtpFromEmail } = settings;

  if (!smtpHost || !smtpUser || !smtpPass) {
    const error = 'SMTP is niet geconfigureerd (Instellingen → Verbindingen).';
    logActivity('error', `Setlist-mail versturen mislukt: ${error}`);
    return { success: false, error };
  }

  if (opts.to.length === 0) {
    return { success: false, error: 'Geen ontvangers opgegeven.' };
  }

  const fromEmail = smtpFromEmail || smtpUser;
  const fromName = smtpFromName || 'Ark Church Livestream Manager';

  try {
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort || 465,
      secure: smtpSecure !== false,
      auth: { user: smtpUser, pass: smtpPass }
    });

    await transporter.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to: fromEmail,
      bcc: opts.to,
      replyTo: opts.replyTo && opts.replyTo.length > 0 ? opts.replyTo : undefined,
      subject: opts.subject,
      text: opts.bodyText,
      attachments: opts.attachments?.map(a => ({ filename: a.filename, content: a.content })),
      // Lets the IMAP cleanup in email.ts find and remove this self-addressed
      // copy after it's been around long enough to be useful for reference,
      // without relying on subject-text matching (which a real mail could
      // coincidentally also match).
      headers: { 'X-Ark-Setlist-Copy': 'true' }
    });

    logActivity('setlist', `Setlist-mail verstuurd: "${opts.subject}" naar ${opts.to.length} ontvanger(s)`, { recipients: opts.to.length });
    return { success: true };
  } catch (error: any) {
    logActivity('error', `Setlist-mail versturen mislukt: ${error.message}`, { subject: opts.subject });
    return { success: false, error: error.message };
  }
}

// Background failures (e.g. the thumbnail-sync check, which runs every 10
// minutes) would otherwise re-alert every single run for as long as the
// underlying problem persists - this cooldown lets the *first* occurrence
// of a given problem through immediately, then stays quiet on repeats of
// the same key for a while so one dead YouTube token doesn't turn into
// dozens of identical emails. Callers should still log every occurrence via
// logActivity themselves (cheap, and the Activiteitenlog is meant to show
// the full history) - this cooldown only throttles the email.
const ALERT_STATE_FILE = path.join(process.cwd(), 'data', 'ops_alert_state.json');
const ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000;

function readAlertState(): Record<string, number> {
  try {
    if (fs.existsSync(ALERT_STATE_FILE)) {
      return JSON.parse(fs.readFileSync(ALERT_STATE_FILE, 'utf-8'));
    }
  } catch {
    // Corrupt/unreadable state file just means "no cooldowns active yet".
  }
  return {};
}

function writeAlertState(state: Record<string, number>) {
  const dir = path.dirname(ALERT_STATE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(ALERT_STATE_FILE, JSON.stringify(state));
}

export interface OpsAlertOptions {
  // Groups repeats of "the same problem" for the cooldown - defaults to the
  // subject, but pass an explicit stable key (e.g. "youtube-token-expired")
  // when the subject text itself varies between occurrences.
  key?: string;
  cooldownMs?: number;
}

// A single fixed-recipient alert for operational failures (expired YouTube
// token, thumbnail sync failing, a sync that couldn't reach the Beamer PC,
// ...) - separate from sendSetlistEmail on purpose: that one BCCs a team
// list and "to"s itself, which would look wrong for a single admin alert,
// and carries setlist-specific headers/activity-log category that don't
// apply here.
export async function sendOpsAlertEmail(subject: string, bodyText: string, opts: OpsAlertOptions = {}): Promise<SendMailResult> {
  const settings = getSettings() as any;
  const { smtpHost, smtpPort, smtpUser, smtpPass, smtpSecure, smtpFromName, smtpFromEmail, opsAlertEmail } = settings;

  if (!opsAlertEmail) {
    return { success: false, error: 'Geen e-mailadres voor foutmeldingen ingesteld (Instellingen → Activiteitenlog).' };
  }
  if (!smtpHost || !smtpUser || !smtpPass) {
    return { success: false, error: 'SMTP is niet geconfigureerd (Instellingen → FreeShow).' };
  }

  const key = opts.key || subject;
  const cooldownMs = opts.cooldownMs ?? ALERT_COOLDOWN_MS;
  const state = readAlertState();
  const lastSent = state[key] || 0;
  if (Date.now() - lastSent < cooldownMs) {
    return { success: false, error: 'Cooldown actief - deze foutmelding is recent al gemaild.' };
  }

  const fromEmail = smtpFromEmail || smtpUser;
  const fromName = smtpFromName || 'Ark Church Livestream Manager';

  try {
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort || 465,
      secure: smtpSecure !== false,
      auth: { user: smtpUser, pass: smtpPass }
    });

    await transporter.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to: opsAlertEmail,
      subject: `[Ark Ops] ${subject}`,
      text: bodyText
    });

    state[key] = Date.now();
    writeAlertState(state);
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}
