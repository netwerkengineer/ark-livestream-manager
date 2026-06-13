import { youtubeFetch } from "./tokenStore";
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

    const internalPath = "/app/public/thumbnails";
    if (!fs.existsSync(internalPath)) {
      fs.mkdirSync(internalPath, { recursive: true });
    }
    const filePath = path.join(internalPath, "thema.jpg");
    fs.writeFileSync(filePath, imageBuffer);
    
    lastSyncedUrl = url;
    console.log(`[Thumbnail Sync] Successfully synced new thumbnail to NAS: ${filePath}`);
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
