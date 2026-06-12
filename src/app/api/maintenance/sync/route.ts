import { NextRequest, NextResponse } from 'next/server';
import { getSettings } from '@/lib/settingsStore';
import { isAuthorized } from "@/lib/authHelper";
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const authSession = await isAuthorized(req, undefined, 'freeshow');
  if (!authSession) {
    return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
  }

  const settings = getSettings();
  
  const rawHosts = [];
  if (settings.tuyaApiHost) {
    rawHosts.push(settings.tuyaApiHost);
  }
  rawHosts.push('127.0.0.1');            
  if (settings.companionHost) {
    rawHosts.push(settings.companionHost);  
  }
  rawHosts.push('172.17.0.1');           

  const hostsToTry = Array.from(new Set(rawHosts.filter(Boolean)));

  console.log(`[SYNC API] Triggering manual sync. Hosts to try:`, hostsToTry);

  let success = false;
  let responseText = '';

  for (const host of hostsToTry) {
    if (!host) continue;
    try {
      const url = `http://${host}:8088/sync`;
      console.log(`[SYNC API] Querying host: ${url}`);
      const res = await fetch(url, { 
        cache: 'no-store',
        signal: AbortSignal.timeout(5000) 
      });
      if (res.ok) {
        responseText = await res.text();
        success = true;
        console.log(`[SYNC API] Successfully triggered sync on host: ${host}. Response: ${responseText}`);
        break;
      } else {
        console.log(`[SYNC API] Host ${host} returned non-ok status: ${res.status}`);
      }
    } catch (e: any) {
      console.log(`[SYNC API] Failed to query host ${host}:`, e.message || e);
    }
  }

  if (!success) {
    return NextResponse.json({ 
      error: 'Could not connect to Tuya HTTP control server to trigger sync' 
    }, { status: 502 });
  }

  return NextResponse.json({ success: true, message: responseText });
}
