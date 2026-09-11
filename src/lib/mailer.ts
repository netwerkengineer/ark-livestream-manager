import nodemailer from 'nodemailer';
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
