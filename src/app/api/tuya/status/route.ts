import { NextRequest, NextResponse } from 'next/server';
import { getSettings } from '@/lib/settingsStore';
import { isAuthorized } from "@/lib/authHelper";

export async function GET(req: NextRequest) {
  const authSession = await isAuthorized(req);
  if (!authSession) {
    return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
  }

  const settings = getSettings();
  
  // Try to reach the Tuya HTTP server on multiple network interfaces
  const hostsToTry = [
    '127.0.0.1',            // Host networking fallback
    settings.companionHost,  // Proxmox LXC 112 LAN IP (192.168.2.222)
    '172.17.0.1',           // Docker default bridge gateway
  ];

  let statusData = [];
  let success = false;

  for (const host of hostsToTry) {
    if (!host) continue;
    try {
      const url = `http://${host}:8088/status_json`;
      const res = await fetch(url, { signal: AbortSignal.timeout(1200) });
      if (res.ok) {
        statusData = await res.json();
        success = true;
        break;
      }
    } catch (e) {
      // Continue to next host
    }
  }

  if (!success) {
    // Return empty list and a warning status instead of a hard crash
    return NextResponse.json({ 
      error: 'Could not connect to Tuya HTTP control server', 
      plugs: [] 
    }, { status: 502 });
  }

  return NextResponse.json({ plugs: statusData });
}
