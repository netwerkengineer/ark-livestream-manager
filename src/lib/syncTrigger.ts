import { getSettings } from '@/lib/settingsStore';
import { logActivity } from '@/lib/activityLog';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

// Fires the same FreeShow/Beamer-PC sync the "Handmatige Sync Starten"
// button uses (src/app/api/maintenance/sync/route.ts, refactored to call
// this shared function) - extracted so other places that just changed
// something FreeShow/OBS cares about (e.g. a fresh thema.jpg) can trigger
// a sync themselves instead of leaving the operator to remember to click
// the button, or waiting for the once-a-day scheduled sync.
//
// keepOn: true (default) = never power off the Beamer PC afterward - for
// someone actively at their machine (the manual sync button). Pass
// keepOn: false for unattended auto-triggers (e.g. after scheduling a
// stream) so the PC is shut down again afterward, matching the operator's
// expectation that only a manual sync leaves it running.
//
// targetKeys: restricts the run to specific targets ("primary" plus any
// freeshowAdditionalTargets id). Every automated call site (auto-trigger
// after scheduling a stream, the background thumbnail check) should always
// pass ["primary"] - additional targets (e.g. a Sunday-school PC) are
// almost always powered off, and are only ever meant to sync when someone
// explicitly picks them via the manual sync button's checkboxes. Omit this
// to sync every enabled target, which only the manual button's "select
// all" case should do.
export async function triggerFreeShowSync(opts: { keepOn?: boolean; targetKeys?: string[] } = {}): Promise<{ success: boolean; message: string }> {
  const keepOn = opts.keepOn !== false;
  const targetKeys = opts.targetKeys;
  const settings = getSettings() as any;

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

  console.log(`[Sync Trigger] Triggering sync. Hosts to try:`, hostsToTry);

  // Try the Tuya HTTP daemon first
  for (const host of hostsToTry) {
    if (!host) continue;
    try {
      let url = `http://${host}:8088/sync?keep_on=${keepOn ? '1' : '0'}`;
      if (targetKeys && targetKeys.length > 0) {
        url += `&targets=${encodeURIComponent(targetKeys.join(','))}`;
      }
      const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const responseText = await res.text();
        console.log(`[Sync Trigger] Successfully triggered sync on host: ${host}. Response: ${responseText}`);
        logActivity('sync', `Sync getriggerd (${keepOn ? 'handmatig/blijft aan' : 'automatisch'})`, { targets: targetKeys, host });
        return { success: true, message: responseText };
      }
      console.log(`[Sync Trigger] Host ${host} returned non-ok status: ${res.status}`);
    } catch (e: any) {
      console.log(`[Sync Trigger] Failed to query host ${host}:`, e.message || e);
    }
  }

  // Fallback: execute the Python script directly if the daemon is unreachable
  const scriptCandidates = [
    path.join(process.cwd(), 'sync_and_cleanup_freeshow.py'),
    '/app/sync_and_cleanup_freeshow.py'
  ];
  const scriptPath = scriptCandidates.find(p => fs.existsSync(p));

  if (!scriptPath) {
    console.log(`[Sync Trigger] Daemon unreachable and script not found in any expected location.`);
    logActivity('error', 'Sync starten mislukt: daemon onbereikbaar en script niet gevonden');
    return { success: false, message: 'Kon geen sync starten (daemon onbereikbaar en script niet gevonden)' };
  }

  try {
    const dataDir = path.join(path.dirname(scriptPath), 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    const logPath = path.join(dataDir, 'sync_cleanup.log');
    fs.appendFileSync(logPath, `\n--- DIRECT SYNC TRIGGERED AT ${new Date().toISOString()} ---\n`);

    // openSync gives a ready-to-use fd with no race, unlike
    // fs.createWriteStream() which opens asynchronously.
    const scriptArgs = [scriptPath];
    if (keepOn) scriptArgs.push('--keep-on');
    if (targetKeys && targetKeys.length > 0) scriptArgs.push(`--only-targets=${targetKeys.join(',')}`);
    const logFd = fs.openSync(logPath, 'a');
    const child = spawn('python3', scriptArgs, {
      detached: true,
      stdio: ['ignore', logFd, logFd]
    });
    fs.closeSync(logFd);
    child.unref();

    console.log(`[Sync Trigger] Direct execution started: ${scriptPath}`);
    logActivity('sync', `Sync getriggerd via direct script (daemon onbereikbaar) (${keepOn ? 'blijft aan' : 'automatisch'})`, { targets: targetKeys });
    return { success: true, message: 'OK: sync started via direct execution (no daemon)' };
  } catch (e: any) {
    console.log(`[Sync Trigger] Direct execution failed:`, e.message || e);
    logActivity('error', `Sync starten mislukt: ${e.message || e}`);
    return { success: false, message: e.message || 'Direct execution failed' };
  }
}
