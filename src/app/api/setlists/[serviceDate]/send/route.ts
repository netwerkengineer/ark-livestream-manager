import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';
import { isAuthorized } from '@/lib/authHelper';
import { getDraftService, updateSongInDraft, DraftSong, DraftService } from '@/lib/draftServicesStore';
import { getContacts, Contact } from '@/lib/contactsStore';
import { buildSongTextFile, buildSongPdf, buildChordsTextFile, sanitizeFilename } from '@/lib/songExport';
import { sendSetlistEmail } from '@/lib/mailer';
import { checkLocalSongExists, getLocalSongText, fetchLyricsFromInternet } from '@/lib/songs';
import { getSongMeta } from '@/lib/songMetaStore';

// Songs parsed from a liturgie e-mail only ever get a title/artist - unlike
// songs added through the setlist UI, they never went through the
// catalog-lookup preview step. Fill the gap here (persisting it back to the
// draft too) so "songtekst als bijlage" holds for e-mail-sourced songs as
// well, not just manually-added ones.
async function withLyricsFilledIn(serviceDate: string, song: DraftSong): Promise<DraftSong> {
  if (song.lyricsText) return song;
  const artist = song.artist || '';
  let text = '';
  try {
    if (await checkLocalSongExists(song.title, artist)) {
      text = await getLocalSongText(song.title, artist);
    }
    if (!text) {
      text = await fetchLyricsFromInternet(song.title, artist);
    }
  } catch {
    // Best-effort - the attachment falls back to "(geen songtekst toegevoegd)".
  }
  if (!text) return song;
  updateSongInDraft(serviceDate, song.id, { lyricsText: text });
  return { ...song, lyricsText: text };
}

function formatDateLabel(iso: string): string {
  try {
    return new Date(iso + 'T00:00:00').toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  } catch {
    return iso;
  }
}

// A song's chords attachment is either its uploaded chord chart (verbatim,
// original extension) or a generated text file from free-text chords -
// mutually exclusive, whichever is set on the song (see songMetaStore's
// "uploading a file clears free-text chords" rule).
function chordsAttachmentFilename(song: DraftSong): string | null {
  if (song.chordsFilePath) {
    const ext = song.chordsFileName ? path.extname(song.chordsFileName) : path.extname(song.chordsFilePath);
    return `${sanitizeFilename(song.title)} (akkoorden)${ext || '.pdf'}`;
  }
  if (song.chordsText) {
    return `${sanitizeFilename(song.title)} (akkoorden).txt`;
  }
  return null;
}

// Shared between the real send and the dry-run preview, so what the
// worship leader sees in the preview is guaranteed to be exactly what goes
// out - no separate client-side re-implementation to drift out of sync.
function buildEmailContent(
  serviceDate: string,
  draft: DraftService,
  message: string | undefined,
  includeText: boolean,
  includePdf: boolean,
  includeChords: boolean,
  includeYoutube: boolean
) {
  const dateLabel = formatDateLabel(serviceDate);
  const bodyLines = [`Setlist voor ${dateLabel}:`, ''];
  draft.songs.forEach((s, i) => {
    bodyLines.push(`${i + 1}. ${s.title}${s.artist ? ` - ${s.artist}` : ''}`);
  });
  if (includeText && includePdf) {
    bodyLines.push('', 'De songteksten staan als tekstbestand en pdf bijgevoegd.');
  } else if (includeText) {
    bodyLines.push('', 'De songteksten staan als bijlage.');
  } else if (includePdf) {
    bodyLines.push('', 'De songteksten staan als pdf bijgevoegd.');
  }
  if (includeChords) {
    bodyLines.push('', 'De akkoorden staan (indien toegevoegd) als aparte bijlage per lied.');
  }
  if (includeYoutube) {
    const withYoutube = draft.songs
      .map(s => ({ song: s, url: getSongMeta(s.title, s.artist)?.youtubeUrl }))
      .filter((x): x is { song: DraftSong; url: string } => !!x.url);
    if (withYoutube.length > 0) {
      bodyLines.push('', '🎥 YouTube-referenties:');
      withYoutube.forEach(({ song, url }) => {
        bodyLines.push(`${song.title}${song.artist ? ` - ${song.artist}` : ''}: ${url}`);
      });
    }
  }
  if (typeof message === 'string' && message.trim()) {
    bodyLines.push('', message.trim());
  }
  return { subject: `Setlist ${dateLabel}`, bodyText: bodyLines.join('\n') };
}

function attachmentFilenames(draft: DraftService, includeText: boolean, includePdf: boolean, includeChords: boolean): string[] {
  return draft.songs.flatMap(s => {
    const base = sanitizeFilename(s.title);
    const names: string[] = [];
    if (includeText) names.push(`${base}.txt`);
    if (includePdf) names.push(`${base}.pdf`);
    if (includeChords) {
      const chordsName = chordsAttachmentFilename(s);
      if (chordsName) names.push(chordsName);
    }
    return names;
  });
}

// Sends the setlist (per-song text files, optionally PDFs) to a chosen set
// of contacts by email. WhatsApp is deliberately not automated here - see
// the "WhatsApp-samenvatting" button in the setlist UI, which reuses the
// existing wa.me deep-link pattern instead of a cloud API.
export async function POST(req: NextRequest, { params }: { params: Promise<{ serviceDate: string }> }) {
  const authSession = await isAuthorized(req, undefined, 'freeshow');
  if (!authSession) {
    return NextResponse.json({ error: 'Niet geautoriseerd' }, { status: 401 });
  }

  const { serviceDate } = await params;
  try {
    const {
      recipientIds,
      replyToIds,
      includePdf,
      includeText: includeTextRaw,
      includeChords,
      includeYoutube,
      message,
      dryRun,
      subject: subjectOverride,
      bodyText: bodyTextOverride
    } = await req.json();
    // Defaults to on (matches the behavior before this became optional) when
    // the field is simply absent, but respects an explicit false.
    const includeText = includeTextRaw !== false;
    if (!Array.isArray(recipientIds) || recipientIds.length === 0) {
      return NextResponse.json({ success: false, error: 'Geen ontvangers geselecteerd' }, { status: 400 });
    }

    const draft = getDraftService(serviceDate);
    if (!draft) {
      return NextResponse.json({ success: false, error: 'Dienst niet gevonden' }, { status: 404 });
    }
    if (draft.songs.length === 0) {
      return NextResponse.json({ success: false, error: 'Deze setlist heeft nog geen liederen' }, { status: 400 });
    }

    const contacts: Contact[] = getContacts();
    const recipients = contacts.filter(c => recipientIds.includes(c.id) && c.email);
    if (recipients.length === 0) {
      return NextResponse.json({ success: false, error: 'Geen van de geselecteerde contactpersonen heeft een e-mailadres' }, { status: 400 });
    }
    // Reply-To is a separate, deliberate opt-in (see the setlist UI) - a
    // worship leader/operator picks who should actually see and answer
    // replies, since the "from"/"to" on the sent mail are the app's own
    // address (see mailer.ts's BCC pattern).
    const replyToContacts = Array.isArray(replyToIds)
      ? contacts.filter(c => replyToIds.includes(c.id) && c.email)
      : [];

    // subjectOverride/bodyTextOverride let the worship leader edit the
    // preview before confirming - the real send then uses exactly what they
    // reviewed instead of recomposing it fresh.
    const composed = buildEmailContent(serviceDate, draft, message, includeText, !!includePdf, !!includeChords, !!includeYoutube);
    const subject = typeof subjectOverride === 'string' && subjectOverride.trim() ? subjectOverride : composed.subject;
    const bodyText = typeof bodyTextOverride === 'string' && bodyTextOverride.trim() ? bodyTextOverride : composed.bodyText;

    // Preview only - no lyrics lookup, no PDF rendering, no e-mail sent.
    // Just enough to show the worship leader exactly what they're about to send.
    if (dryRun) {
      return NextResponse.json({
        success: true,
        preview: {
          to: recipients.map(r => ({ name: r.name, email: r.email! })),
          replyTo: replyToContacts.map(r => ({ name: r.name, email: r.email! })),
          subject,
          bodyText,
          attachments: attachmentFilenames(draft, includeText, !!includePdf, !!includeChords)
        }
      });
    }

    const attachments = [];
    if (includeText || includePdf) {
      for (const song of draft.songs) {
        const songForExport = await withLyricsFilledIn(serviceDate, song);
        if (includeText) attachments.push(buildSongTextFile(songForExport));
        if (includePdf) attachments.push(await buildSongPdf(songForExport));
      }
    }
    if (includeChords) {
      for (const song of draft.songs) {
        if (song.chordsFilePath) {
          try {
            const content = await readFile(song.chordsFilePath);
            const filename = chordsAttachmentFilename(song);
            if (filename) attachments.push({ filename, content });
          } catch {
            // Uploaded file went missing on disk - skip rather than fail the whole send.
          }
        } else if (song.chordsText) {
          attachments.push(buildChordsTextFile(song));
        }
      }
    }

    const result = await sendSetlistEmail({
      to: recipients.map(r => r.email!),
      replyTo: replyToContacts.map(r => r.email!),
      subject,
      bodyText,
      attachments
    });

    if (!result.success) {
      return NextResponse.json({ success: false, error: result.error }, { status: 500 });
    }
    return NextResponse.json({ success: true, sentTo: recipients.length });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
