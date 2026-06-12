import { NextRequest, NextResponse } from 'next/server';
import { getSettings } from '@/lib/settingsStore';
import { isAuthorized } from "@/lib/authHelper";
import { exec } from 'child_process';
import path from 'path';
import fs from 'fs';
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

  // Try Tuya HTTP daemon first
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

  // Fallback: execute Python script directly if daemon is unreachable
  if (!success) {
    console.log(`[SYNC API] Daemon unreachable. Attempting direct script execution...`);
    
    // Look for the script in multiple locations
    const scriptCandidates = [
      path.join(process.cwd(), 'sync_and_cleanup_freeshow.py'),
      '/app/sync_and_cleanup_freeshow.py'
    ];
    
    let scriptPath = '';
    for (const candidate of scriptCandidates) {
      if (fs.existsSync(candidate)) {
        scriptPath = candidate;
        break;
      }
    }
    
    if (scriptPath) {
      try {
        // Ensure data directory exists for log file
        const dataDir = path.join(path.dirname(scriptPath), 'data');
        if (!fs.existsSync(dataDir)) {
          fs.mkdirSync(dataDir, { recursive: true });
        }
        
        // Execute in background (fire and forget)
        const logPath = path.join(dataDir, 'sync_cleanup.log');
        fs.appendFileSync(logPath, `\n--- DIRECT MANUAL SYNC TRIGGERED AT ${new Date().toISOString()} ---\n`);
        
        exec(`python3 "${scriptPath}" >> "${logPath}" 2>&1 &`);
        
        success = true;
        responseText = 'OK: Manual sync started via direct execution (no daemon)';
        console.log(`[SYNC API] Direct execution started: ${scriptPath}`);
      } catch (e: any) {
        console.log(`[SYNC API] Direct execution failed:`, e.message || e);
      }
    } else {
      console.log(`[SYNC API] Script not found in any expected location`);
    }
  }

  if (!success) {
    return NextResponse.json({ 
      error: 'Could not connect to Tuya HTTP control server to trigger sync' 
    }, { status: 502 });
  }

  return NextResponse.json({ success: true, message: responseText });
}
