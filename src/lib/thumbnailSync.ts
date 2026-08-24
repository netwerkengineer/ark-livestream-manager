import { youtubeFetch } from "./tokenStore";
import { getSettings } from "./settingsStore";
import { triggerFreeShowSync } from "./syncTrigger";
import fs from "fs";
import path from "path";

let lastSyncedUrl = "";

async function syncThumbnailFromUrl(url: string) {
  if (url === lastSyncedUrl) {
    return;
  }
  
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`[Thumbnail Sync] Failed to fetch image from URL: ${url}, status: ${res.status}`);
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
      } catch (pathErr) {
        console.error(`[Thumbnail Sync] Failed to write to custom path ${savePath}:`, pathErr);
      }
    }
    
    lastSyncedUrl = url;

    // thema.jpg only lives on the NAS at this point - the Beamer PC's own
    // FreeShow install reads media from its own local disk (confirmed:
    // freeshowClientPath is a plain local Windows path, not a network
    // share), so the "Welkom" show there won't see this update until a
    // sync propagates it. Trigger one now instead of leaving it to the
    // once-a-day scheduled sync or requiring the operator to remember.
    // keepOn stays at its default (true/never-shutdown) here deliberately -
    // this function also runs from a passive 10-minute background interval
    // AND once on every app startup (initThumbnailSync()), neither of which
    // reflects "the operator just scheduled a stream". Since lastSyncedUrl
    // is only in-memory, it resets on every restart, so a keepOn:false here
    // would fire an unattended shutdown-triggering sync on every deploy.
    // targetKeys: ['primary'] - same reasoning as create/route.ts: this is
    // an automated trigger, and additional targets only ever sync when
    // someone explicitly picks them via the manual sync button.
    triggerFreeShowSync({ targetKeys: ['primary'] }).catch(err => console.error("[Thumbnail Sync] Kon sync niet triggeren:", err));
  } catch (err) {
    console.error("[Thumbnail Sync] Error syncing thumbnail:", err);
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
      return;
    }

    const ytData = await ytRes.json();
    if (ytData.error) {
      console.error("[Thumbnail Sync] YouTube API Error:", JSON.stringify(ytData.error));
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
  } catch (err) {
    console.error("[Thumbnail Sync] Error during background check:", err);
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
