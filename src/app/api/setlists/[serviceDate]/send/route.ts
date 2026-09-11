import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized } from '@/lib/authHelper';
import { getDraftService } from '@/lib/draftServicesStore';
import { getContacts } from '@/lib/contactsStore';
import { buildSongTextFile, buildSongPdf } from '@/lib/songExport';
import { sendSetlistEmail } from '@/lib/mailer';

function formatDateLabel(iso: string): string {
  try {
    return new Date(iso + 'T00:00:00').toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  } catch {
    return iso;
  }
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
    const { recipientIds, includePdf } = await req.json();
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

    const contacts = getContacts();
    const recipients = contacts.filter(c => recipientIds.includes(c.id) && c.email);
    if (recipients.length === 0) {
      return NextResponse.json({ success: false, error: 'Geen van de geselecteerde contactpersonen heeft een e-mailadres' }, { status: 400 });
    }

    const attachments = [];
    for (const song of draft.songs) {
      attachments.push(buildSongTextFile(song));
      if (includePdf) {
        attachments.push(await buildSongPdf(song));
      }
    }

    const dateLabel = formatDateLabel(serviceDate);
    const bodyLines = [`Setlist voor ${dateLabel}:`, ''];
    draft.songs.forEach((s, i) => {
      bodyLines.push(`${i + 1}. ${s.title}${s.artist ? ` - ${s.artist}` : ''}`);
    });
    bodyLines.push('', 'De songteksten (en akkoorden, indien toegevoegd) staan als bijlage.');

    const result = await sendSetlistEmail({
      to: recipients.map(r => r.email!),
      subject: `Setlist ${dateLabel}`,
      bodyText: bodyLines.join('\n'),
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
