import { NextRequest, NextResponse } from 'next/server';
import { getSettings } from '@/lib/settingsStore';
import { isAuthorized } from "@/lib/authHelper";
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const authSession = await isAuthorized(req, undefined, "control");
  if (!authSession) {
    return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
  }

  const settings = getSettings();
  
  // Try to reach the Tuya HTTP server on multiple network interfaces
  const rawHosts = [];
  if (settings.tuyaApiHost) {
    rawHosts.push(settings.tuyaApiHost);
  }
  rawHosts.push('127.0.0.1');            // Host networking fallback
  if (settings.companionHost) {
    rawHosts.push(settings.companionHost);  // Proxmox LXC 112 LAN IP (192.168.2.222)
  }
  rawHosts.push('172.17.0.1');           // Docker default bridge gateway

  // Deduplicate hosts to avoid redundant requests to the single-threaded/caching Tuya daemon
  const hostsToTry = Array.from(new Set(rawHosts.filter(Boolean)));

  console.log(`[TUYA API] Starting status query. Hosts to try:`, hostsToTry);

  let statusData = [];
  let success = false;

  for (const host of hostsToTry) {
    if (!host) continue;
    try {
      const url = `http://${host}:8088/status_json`;
      console.log(`[TUYA API] Querying host: ${url}`);
      const res = await fetch(url, { 
        cache: 'no-store',
        signal: AbortSignal.timeout(3000) 
      });
      if (res.ok) {
        statusData = await res.json();
        success = true;
        console.log(`[TUYA API] Successfully got status from host: ${host}, plugs count: ${statusData.length}`);
        break;
      } else {
        console.log(`[TUYA API] Host ${host} returned non-ok status: ${res.status}`);
      }
    } catch (e: any) {
      console.log(`[TUYA API] Failed to query host ${host}:`, e.message || e);
    }
  }

  console.log(`[TUYA API] Query complete. Success: ${success}, plugs count: ${statusData.length}`);

  if (!success) {
    // Return empty list and a warning status instead of a hard crash
    return NextResponse.json({ 
      error: 'Could not connect to Tuya HTTP control server', 
      plugs: [] 
    }, { status: 502 });
  }

  return NextResponse.json({ plugs: statusData });
}
