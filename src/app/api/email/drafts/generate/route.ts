import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized } from '@/lib/authHelper';
import path from 'path';
import { getDraftService, updateMediaInDraft } from '@/lib/draftServicesStore';
import { getSettings } from '@/lib/settingsStore';
import { downloadYoutubeVideo, youtubeFout } from '@/lib/youtubeDownload';
import { generateProjectForDraft } from '@/lib/draftProjectGenerator';
import { syncAfterProjectSave } from '@/lib/syncTrigger';

// Diensten waarvan de YouTube-video's op de achtergrond worden gedownload, voordat het project wordt gemaakt
const wachtOpDownload = new Set<string>();

// Manually (re)generates the FreeShow project for one draft service - used
// both for the initial "Project aanmaken" action and "Project bijwerken"
// after a correction, and for the explicit "Toch overschrijven" retry when
// generateProjectForDraft reports a conflict.
export async function POST(req: NextRequest) {
  const authSession = await isAuthorized(req, undefined, 'freeshow');
  if (!authSession) {
    return NextResponse.json({ error: 'Niet geautoriseerd' }, { status: 401 });
  }

  try {
    const { serviceDate, force } = await req.json();
    if (!serviceDate) {
      return NextResponse.json({ success: false, error: 'serviceDate ontbreekt' }, { status: 400 });
    }

    const draft = getDraftService(serviceDate);
    if (!draft) {
      return NextResponse.json({ success: false, error: 'Concept-dienst niet gevonden' }, { status: 404 });
    }

    // Een YouTube-video die nog niet gedownload is, kan minuten duren: dat past niet binnen de wachttijd van de
    // proxy (dan komt er een HTML-foutpagina terug). Download dus op de achtergrond en maak het project daarna.
    const mediaDir = (getSettings() as any).freeshowMediaPath;
    const teDownloaden = mediaDir ? draft.media.filter(m => m.mediaType === 'youtube' && !m.filePath && m.url) : [];
    if (teDownloaden.length > 0) {
      if (!wachtOpDownload.has(serviceDate)) {
        wachtOpDownload.add(serviceDate);
        teDownloaden.forEach(m => updateMediaInDraft(serviceDate, m.id, { downloadStatus: 'bezig' }));
        (async () => {
          try {
            await Promise.all(teDownloaden.map(async m => {
              const r = await downloadYoutubeVideo(m.url!, path.join(mediaDir, 'YouTube'), !!m.audioOnly);
              updateMediaInDraft(serviceDate, m.id, r
                ? { filePath: r.filePath, attachmentName: `${r.title}.${m.audioOnly ? 'm4a' : 'mp4'}` }
                : { downloadStatus: 'mislukt', downloadFout: youtubeFout(m.url!) });
            }));
            const fresh = getDraftService(serviceDate);
            if (fresh) {
              const res = await generateProjectForDraft(fresh, { force: !!force });
              if (res.success) await syncAfterProjectSave();
              else console.error('[Project Generator] Na download niet gelukt:', res.message);
            }
          } catch (err) {
            console.error('[Project Generator] Fout na YouTube-download:', err);
          } finally {
            wachtOpDownload.delete(serviceDate);
          }
        })();
      }
      return NextResponse.json({
        success: true,
        message: `De YouTube-video wordt gedownload (kan een paar minuten duren). Het project wordt daarna automatisch bijgewerkt; je kunt hier gewoon doorgaan.`
      });
    }

    const result = await generateProjectForDraft(draft, { force: !!force });
    if (result.success) {
      // Project (en de plaatjes erbij) naar de Beamer-pc brengen, maar alleen als die al aan staat
      result.message = `${result.message || 'Project opgeslagen'}.${await syncAfterProjectSave()}`;
    }
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[Project Generator] Fout:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
