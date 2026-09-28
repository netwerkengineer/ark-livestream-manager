import { youtubeFetch } from "./tokenStore";
import { getSettings } from "./settingsStore";
import { triggerFreeShowSync } from "./syncTrigger";
import { logActivity } from "./activityLog";
import { sendOpsAlertEmail } from "./mailer";
import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const STATE_FILE = path.join(DATA_DIR, "thumbnail_sync_state.json");

// Persisted to disk (not just an in-memory variable) so a container
// restart - e.g. during a deploy - doesn't make initThumbnailSync() think
// an already-synced thumbnail is new. See the keepOn comment below for why
// that distinction matters: an unchanged thumbnail now correctly triggers
// no sync at all after a restart, instead of one that leaves the Beamer PC
// powered on unexpectedly.
function readLastSyncedUrl(): string {
  if (fs.existsSync(STATE_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
      return parsed.lastSyncedUrl || "";
    } catch (e) {
      console.error("[Thumbnail Sync] Kon state-bestand niet lezen, start leeg:", e);
    }
  }
  return "";
}

function writeLastSyncedUrl(url: string) {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(STATE_FILE, JSON.stringify({ lastSyncedUrl: url }));
}

async function syncThumbnailFromUrl(url: string) {
  if (url === readLastSyncedUrl()) {
    return;
  }

  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`[Thumbnail Sync] Failed to fetch image from URL: ${url}, status: ${res.status}`);
      logActivity("error", `Thumbnail-sync mislukt: ophalen van de YouTube-thumbnail gaf status ${res.status}.`, { url });
      sendOpsAlertEmail(
        "Thumbnail-sync mislukt (ophalen bij YouTube)",
        `Het ophalen van de thumbnail-afbeelding bij YouTube gaf status ${res.status}.\n\nURL: ${url}\n\nthema.jpg wordt hierdoor niet bijgewerkt.`,
        { key: "thumbnail-fetch-failed" }
      ).catch(() => {});
      return;
    }
    const arrayBuffer = await res.arrayBuffer();
    const imageBuffer = Buffer.from(arrayBuffer);

    // 1. Sla lokaal op in de app (voor Next.js public URL / OBS)
    const internalPath = "/app/public/thumbnails";
    if (!fs.existsSync(internalPath)) {
      fs.mkdirSync(internalPath, { recursive: true });
    }
    const filePath = path.join(internalPath, "thema.jpg");
    fs.writeFileSync(filePath, imageBuffer);
    console.log(`[Thumbnail Sync] Successfully synced new thumbnail to Next.js public folder: ${filePath}`);

    // 2. Sla lokaal op in de geconfigureerde FreeShow Media map op de NAS (voor netwerktoegang)
    const settings = getSettings();
    const savePath = settings.thumbnailSavePath;
    if (savePath) {
      try {
        if (!fs.existsSync(savePath)) {
          fs.mkdirSync(savePath, { recursive: true });
        }
        const customFilePath = path.join(savePath, "thema.jpg");
        fs.writeFileSync(customFilePath, imageBuffer);
        console.log(`[Thumbnail Sync] Successfully synced new thumbnail to custom path: ${customFilePath}`);
      } catch (pathErr: any) {
        console.error(`[Thumbnail Sync] Failed to write to custom path ${savePath}:`, pathErr);
        logActivity("error", `Thumbnail-sync: wegschrijven naar '${savePath}' mislukt (${pathErr?.message || pathErr}). De lokale kopie in de app is wel bijgewerkt.`);
        sendOpsAlertEmail(
          "Thumbnail-sync: NAS-pad niet schrijfbaar",
          `thema.jpg kon niet weggeschreven worden naar '${savePath}':\n${pathErr?.message || pathErr}\n\nDe kopie binnen de app zelf is wel bijgewerkt, maar FreeShow op de Beamer-PC ziet deze niet totdat dit pad weer schrijfbaar is.`,
          { key: "thumbnail-nas-write-failed" }
        ).catch(() => {});
      }
    }
    
    writeLastSyncedUrl(url);

    // thema.jpg only lives on the NAS at this point - the Beamer PC's own
    // FreeShow install reads media from its own local disk (confirmed:
    // freeshowClientPath is a plain local Windows path, not a network
    // share), so the "Welkom" show there won't see this update until a
    // sync propagates it. Trigger one now instead of leaving it to the
    // once-a-day scheduled sync or requiring the operator to remember.
    // keepOn stays at its default (true/never-shutdown) here deliberately -
    // this function also runs from a passive 10-minute background interval
    // AND once on every app startup (initThumbnailSync()), neither of which
    // reflects "the operator just scheduled a stream" the way create/route.ts's
    // explicit keepOn:false trigger does. A genuinely new thumbnail spotted
    // by this background check could happen at any time of day unrelated to
    // stream prep, so an unattended shutdown here would be unsafe - that's
    // still true even though lastSyncedUrl is now persisted to disk (see
    // above) specifically to stop a restart alone from being mistaken for
    // "new thumbnail" and firing this in the first place.
    // targetKeys: ['primary'] - same reasoning as create/route.ts: this is
    // an automated trigger, and additional targets only ever sync when
    // someone explicitly picks them via the manual sync button.
    triggerFreeShowSync({ targetKeys: ['primary'] }).catch(err => {
      console.error("[Thumbnail Sync] Kon sync niet triggeren:", err);
      logActivity("error", `Thumbnail-sync: het triggeren van de FreeShow-sync naar de Beamer-PC is mislukt (${err?.message || err}). thema.jpg staat wel klaar op de NAS.`);
      sendOpsAlertEmail(
        "Thumbnail-sync: kon Beamer-PC niet syncen",
        `thema.jpg is bijgewerkt op de NAS, maar de sync naar de Beamer-PC kon niet gestart worden:\n${err?.message || err}\n\nMogelijk is de Beamer-PC niet bereikbaar (bekend probleem: PC start niet altijd vanzelf op via de stekker).`,
        { key: "thumbnail-sync-trigger-failed" }
      ).catch(() => {});
    });
  } catch (err: any) {
    console.error("[Thumbnail Sync] Error syncing thumbnail:", err);
    logActivity("error", `Thumbnail-sync onverwacht mislukt: ${err?.message || err}`);
    sendOpsAlertEmail(
      "Thumbnail-sync onverwacht mislukt",
      `De thumbnail-sync gaf een onverwachte fout:\n${err?.message || err}`,
      { key: "thumbnail-sync-unexpected-error" }
    ).catch(() => {});
  }
}

export async function checkAndSyncUpcomingStreamThumbnail() {
  try {
    console.log("[Thumbnail Sync] Checking for upcoming streams...");
    const ytRes = await youtubeFetch(
      "https://www.googleapis.com/youtube/v3/liveBroadcasts?part=snippet,status&mine=true&maxResults=50",
      { cache: "no-store" }
    );
    
    if (ytRes.status === 401) {
      console.warn("[Thumbnail Sync] YouTube credentials expired or invalid, skipping sync.");
      logActivity("error", "Thumbnail-sync overgeslagen: YouTube-koppeling is verlopen of ongeldig. Log opnieuw in bij Planner → Inloggen met Google.");
      sendOpsAlertEmail(
        "YouTube-koppeling verlopen (thumbnail-sync gestopt)",
        "De YouTube-koppeling is verlopen of ongeldig, waardoor thema.jpg niet meer automatisch wordt bijgewerkt.\n\n" +
        "Los dit op door in de Planner opnieuw op 'Inloggen met Google' te klikken.\n\n" +
        "Dit bericht wordt maximaal eens per 6 uur verstuurd zolang het probleem aanhoudt."
      ).catch(() => {});
      return;
    }

    const ytData = await ytRes.json();
    if (ytData.error) {
      console.error("[Thumbnail Sync] YouTube API Error:", JSON.stringify(ytData.error));
      logActivity("error", `Thumbnail-sync: YouTube API-fout (${ytData.error?.message || 'onbekend'}).`, { error: ytData.error });
      sendOpsAlertEmail(
        "Thumbnail-sync: YouTube API-fout",
        `De YouTube API gaf een fout terug:\n${JSON.stringify(ytData.error, null, 2)}`,
        { key: "thumbnail-youtube-api-error" }
      ).catch(() => {});
      return;
    }

    if (ytData.items && ytData.items.length > 0) {
      // Filter out completed/revoked and sort by start time
      const upcomingStreams = ytData.items
        .filter((item: any) => item.status.lifeCycleStatus !== "complete" && item.status.lifeCycleStatus !== "revoked")
        .sort((a: any, b: any) => new Date(a.snippet.scheduledStartTime).getTime() - new Date(b.snippet.scheduledStartTime).getTime());

      if (upcomingStreams.length > 0) {
        const nextStream = upcomingStreams[0];
        const thumbnails = nextStream.snippet?.thumbnails;
        const thumbUrl = thumbnails?.maxres?.url || thumbnails?.standard?.url || thumbnails?.high?.url || thumbnails?.medium?.url || thumbnails?.default?.url;
        
        if (thumbUrl) {
          console.log(`[Thumbnail Sync] Found upcoming stream: "${nextStream.snippet.title}", syncing thumbnail...`);
          await syncThumbnailFromUrl(thumbUrl);
        } else {
          console.log(`[Thumbnail Sync] Upcoming stream "${nextStream.snippet.title}" has no thumbnail URL.`);
        }
      } else {
        console.log("[Thumbnail Sync] No active upcoming streams found in list.");
      }
    } else {
      console.log("[Thumbnail Sync] No upcoming streams returned by YouTube API.");
    }
  } catch (err: any) {
    console.error("[Thumbnail Sync] Error during background check:", err);
    logActivity("error", `Thumbnail-sync onverwacht mislukt tijdens de achtergrondcheck: ${err?.message || err}`);
    sendOpsAlertEmail(
      "Thumbnail-sync: achtergrondcheck mislukt",
      `De periodieke thumbnail-check gaf een onverwachte fout:\n${err?.message || err}`,
      { key: "thumbnail-background-check-failed" }
    ).catch(() => {});
  }
}

export function initThumbnailSync() {
  console.log("[Thumbnail Sync] Initializing background thumbnail sync task...");
  // Run an initial check immediately on startup
  checkAndSyncUpcomingStreamThumbnail().catch(err => console.error("[Thumbnail Sync] Initial check error:", err));
  
  // Then run every 10 minutes
  setInterval(() => {
    console.log("[Thumbnail Sync] Running scheduled background check...");
    checkAndSyncUpcomingStreamThumbnail().catch(err => console.error("[Thumbnail Sync] Scheduled check error:", err));
  }, 10 * 60 * 1000);
}
