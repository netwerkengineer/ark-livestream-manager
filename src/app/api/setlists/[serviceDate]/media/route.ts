import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { isAuthorized } from '@/lib/authHelper';
import { addMediaToDraft, updateMediaInDraft } from '@/lib/draftServicesStore';
import { getSettings } from '@/lib/settingsStore';
import { downloadYoutubeVideo, youtubeFout } from '@/lib/youtubeDownload';

// Adds one media item (YouTube link, uploaded file, or plain link) to a
// setlist being built directly in the app - the worship-leader-facing
// counterpart to what the e-mail parser does for a Media block. File
// uploads themselves go through the existing /api/upload route first; this
// route just records the resulting path against the draft.
export async function POST(req: NextRequest, { params }: { params: Promise<{ serviceDate: string }> }) {
  const authSession = await isAuthorized(req, undefined, 'freeshow');
  if (!authSession) {
    return NextResponse.json({ error: 'Niet geautoriseerd' }, { status: 401 });
  }

  const { serviceDate } = await params;
  try {
    const body = await req.json();
    const { mediaType, url, attachmentName, filePath, section } = body;
    if (!['youtube', 'attachment', 'link'].includes(mediaType)) {
      return NextResponse.json({ success: false, error: 'Ongeldig media-type' }, { status: 400 });
    }
    if (mediaType === 'attachment' && !filePath) {
      return NextResponse.json({ success: false, error: 'Bestand is verplicht' }, { status: 400 });
    }
    if (mediaType !== 'attachment' && (!url || !String(url).trim())) {
      return NextResponse.json({ success: false, error: 'Link is verplicht' }, { status: 400 });
    }
    if (!section || typeof section !== 'string' || !section.trim()) {
      return NextResponse.json({ success: false, error: 'Sectie is verplicht' }, { status: 400 });
    }

    // Een YouTube-link kan alleen als echte media in het project komen als de video er als bestand staat.
    // De download duurt vaak langer dan de proxy wacht, dus hij loopt op de achtergrond; het item staat
    // meteen in de setlist met status 'bezig' en de bouwer ververst zichzelf tot het klaar is.
    const youtubeUrl = mediaType === 'youtube' ? String(url).trim() : '';
    const mediaDir = youtubeUrl ? (getSettings() as any).freeshowMediaPath : '';
    let waarschuwing: string | undefined;
    if (youtubeUrl && !mediaDir) {
      waarschuwing = 'Geen FreeShow-mediamap ingesteld; de video wordt niet gedownload en komt niet in het project.';
    }

    const draft = addMediaToDraft(serviceDate, {
      mediaType,
      url: url ? String(url).trim() : undefined,
      attachmentName,
      filePath,
      ...(youtubeUrl && mediaDir ? { downloadStatus: 'bezig' as const } : {}),
      section: section.trim()
    });

    if (youtubeUrl && mediaDir) {
      const item = draft.media.find(m => m.mediaType === 'youtube' && m.url === youtubeUrl);
      if (item && !item.filePath) {
        downloadYoutubeVideo(youtubeUrl, path.join(mediaDir, 'YouTube'))
          .then(result => updateMediaInDraft(serviceDate, item.id, result
            ? { filePath: result.filePath, attachmentName: `${result.title}.mp4` }
            : { downloadStatus: 'mislukt', downloadFout: youtubeFout(youtubeUrl) }))
          .catch(e => updateMediaInDraft(serviceDate, item.id, { downloadStatus: 'mislukt', downloadFout: String(e?.message || e).slice(0, 300) }));
      }
    }

    return NextResponse.json({ success: true, draft, ...(waarschuwing ? { warning: waarschuwing } : {}) });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
