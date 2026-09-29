/**
 * obsManager.ts — Server-side OBS WebSocket singleton
 * 
 * Maintains a persistent ws:// connection from the Next.js server to OBS.
 * The browser polls /api/obs/status via HTTPS instead of connecting directly.
 * This avoids the browser wss:// requirement when OBS doesn't support TLS.
 */

import OBSWebSocket from 'obs-websocket-js';
import { getSettings } from './settingsStore';
import { youtubeFetch } from './tokenStore';
import { logActivity } from './activityLog';
import { sendOpsAlertEmail } from './mailer';
import { isWithinSundayServiceWindow } from './serviceWindow';
import { spawn } from 'child_process';
import path from 'path';

// Helper function to validate and sanitize shell arguments
function sanitizeShellArg(arg: string): string {
  // Remove any characters that could be used for command injection
  // Allow only alphanumeric, spaces, hyphens, underscores, dots, slashes, colons, and hash
  return arg.replace(/[^a-zA-Z0-9\s\-_./:@#]/g, '');
}

// Helper to execute SSH command safely
function execSshCommand(
  user: string,
  host: string,
  command: string,
  callback: (error: Error | null, stdout: string, stderr: string) => void
): void {
  const sanitizedUser = sanitizeShellArg(user);
  const sanitizedHost = sanitizeShellArg(host);

  const args = [
    '-o', 'ConnectTimeout=3',
    '-o', 'StrictHostKeyChecking=no',
    `${sanitizedUser}@${sanitizedHost}`,
    command
  ];

  let stdout = '';
  let stderr = '';

  const proc = spawn('ssh', args);

  proc.stdout.on('data', (data) => {
    stdout += data.toString();
  });

  proc.stderr.on('data', (data) => {
    stderr += data.toString();
  });

  proc.on('close', (code) => {
    if (code === 0) {
      callback(null, stdout, stderr);
    } else {
      callback(new Error(`SSH command failed with code ${code}`), stdout, stderr);
    }
  });

  proc.on('error', (err) => {
    callback(err, stdout, stderr);
  });
}

// Helper to execute SCP command safely
function execScpCommand(
  localPath: string,
  user: string,
  host: string,
  remotePath: string,
  callback: (error: Error | null) => void
): void {
  const sanitizedUser = sanitizeShellArg(user);
  const sanitizedHost = sanitizeShellArg(host);
  const sanitizedRemotePath = sanitizeShellArg(remotePath);

  const args = [
    '-o', 'ConnectTimeout=5',
    '-o', 'StrictHostKeyChecking=no',
    localPath,
    `${sanitizedUser}@${sanitizedHost}:${sanitizedRemotePath}`
  ];

  const proc = spawn('scp', args);

  proc.on('close', (code) => {
    if (code === 0) {
      callback(null);
    } else {
      callback(new Error(`SCP command failed with code ${code}`));
    }
  });

  proc.on('error', (err) => {
    callback(err);
  });
}

let lastStreamActiveState: boolean | null = null;
let youtubePollTimer: NodeJS.Timeout | null = null;

export async function checkYouTubeLiveState(): Promise<boolean | null> {
  try {
    const res = await youtubeFetch(
      "https://www.googleapis.com/youtube/v3/liveBroadcasts?part=status&broadcastStatus=active&mine=true",
      { cache: "no-store" }
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (data.items && Array.isArray(data.items)) {
      const isLive = data.items.some(
        (item: any) => item.status?.lifeCycleStatus === "live" || item.status?.lifeCycleStatus === "liveStarting"
      );
      return isLive;
    }
    return false;
  } catch (err: any) {
    console.error("[YouTube Live Check] Error fetching live status:", err?.message || err);
    return null;
  }
}

// lastStreamActiveState is only committed to a new value once the remote
// SSH/SCP command to the physical panel actually confirms success (see
// handleStreamStateChange's returned promise below). Committing it
// optimistically before that was the original bug: a single transient SSH
// failure (panel/Bluetooth host briefly unreachable) would still mark the
// update as "done" internally, so the next poll saw no state change to
// react to and never retried - leaving the physical panel stuck showing
// whatever it last actually displayed, sometimes for the rest of the day.
// Leaving it uncommitted on failure means the very next poll (10s later)
// still sees a mismatch and tries again, until it truly succeeds.
export async function updateLedState(isOBSActive: boolean) {
  const settings = getSettings();
  if (!settings.ledPanelEnabled) return;

  const triggerSource = settings.ledTriggerSource || "youtube";

  if (triggerSource === "obs") {
    if (lastStreamActiveState !== isOBSActive) {
      const ok = await handleStreamStateChange(isOBSActive);
      if (ok) lastStreamActiveState = isOBSActive;
    }
  } else {
    // YouTube trigger mode
    const isYtLive = await checkYouTubeLiveState();
    if (isYtLive !== null && lastStreamActiveState !== isYtLive) {
      console.log(`[LED Control] YouTube status changed to: ${isYtLive ? 'LIVE (ON AIR)' : 'OFFLINE'}. Updating LED Sign Board...`);
      const ok = await handleStreamStateChange(isYtLive);
      if (ok) lastStreamActiveState = isYtLive;
    }
  }
}

// Every 10s (24/7, regardless of whether a service is even happening) was
// 8,640 YouTube API calls/day on its own - ~86% of the whole default
// 10,000-unit daily quota, confirmed as the dominant cause of a real
// quotaExceeded incident (2026-09-29, production at 9,427/10,000 units for
// the day with this as by far the largest contributor). A physical LED
// sign board doesn't need sub-minute precision - 60s still updates it
// promptly relative to a human noticing, at 1/6th the API cost (1,440
// calls/day).
const YOUTUBE_LIVE_POLL_INTERVAL_MS = 60000;

// checkYouTubeLiveState() returns null on any fetch error or non-ok API
// response (e.g. quotaExceeded) - the poll below silently does nothing in
// that case, which is exactly what stranded the LED panel showing a stale
// state through an entire service on 2026-09-14/21ish (confirmed: manually
// testing the panel from the Monitor page worked, since that bypasses this
// YouTube check entirely, but it never flipped on its own when the stream
// actually went live or ended). A handful of consecutive nulls could still
// be a one-off blip, so this only alerts once the check has been unable to
// determine live status for several polls in a row - not on the very first
// failure, but well before someone sitting through a whole broken service
// would otherwise be the first to notice.
let consecutiveNullChecks = 0;
const NULL_CHECK_ALERT_THRESHOLD = 3;

// The service is (almost) always Sunday ~10:30-12:00 - checking YouTube
// live status 24/7 the rest of the week is quota spent on days there's
// essentially never a stream to detect. Gated to a configurable Sunday
// window (Instellingen -> Presentatie, default 10:00-12:30 Europe/
// Amsterdam - buffer either side of the usual service) - cuts this poll's
// usage to a couple hundred calls once a week instead of ~1,440/day,
// every day.
// A holiday service on another day (Kerstavond, Goede Vrijdag, ...) won't
// auto-detect here - use the manual test button on the Monitor page (which
// always works, bypassing this check entirely) or switch ledTriggerSource
// to "obs" for that day, rather than maintaining a holiday calendar for a
// handful of days a year.
// (isWithinSundayServiceWindow lives in serviceWindow.ts - also used by the
// public live-status API, which has the same quota incentive to skip
// polling YouTube outside service hours.)

function initYouTubeLivePolling() {
  if (youtubePollTimer) return;
  youtubePollTimer = setInterval(async () => {
    const settings = getSettings();
    if (!settings.ledPanelEnabled) return;
    const triggerSource = settings.ledTriggerSource || "youtube";
    if (triggerSource === "youtube") {
      if (!isWithinSundayServiceWindow(settings)) return;
      const isYtLive = await checkYouTubeLiveState();
      if (isYtLive === null) {
        consecutiveNullChecks++;
        if (consecutiveNullChecks === NULL_CHECK_ALERT_THRESHOLD) {
          const message = `LED-paneel: YouTube-livestatus kon ${NULL_CHECK_ALERT_THRESHOLD} keer op rij niet opgehaald worden - het paneel kan hierdoor vastlopen op de laatst bekende stand (bv. bij een verlopen YouTube-koppeling of een quota-fout).`;
          logActivity('error', message);
          sendOpsAlertEmail(
            'LED-paneel: YouTube-status niet op te halen',
            message,
            { key: 'led-youtube-check-failing', cooldownMs: 30 * 60 * 1000 }
          ).catch(() => {});
        }
        return;
      }
      consecutiveNullChecks = 0;
      if (lastStreamActiveState !== isYtLive) {
        console.log(`[LED Control] Periodic YouTube check: status changed to ${isYtLive ? 'LIVE (ON AIR)' : 'OFFLINE'}`);
        const ok = await handleStreamStateChange(isYtLive);
        if (ok) lastStreamActiveState = isYtLive;
      }
    }
  }, YOUTUBE_LIVE_POLL_INTERVAL_MS);
}

export function handleStreamStateChange(isActive: boolean, customText?: string | null, customColor?: string | null): Promise<boolean> {
  const settings = getSettings();
  if (!settings.ledPanelEnabled) return Promise.resolve(false);

  const remoteHost = settings.ledHost || settings.obsHost || '192.168.2.100';
  let remoteUser = 'jeffreygo';
  if (remoteHost === '192.168.2.100') {
    remoteUser = 'beamer';
  } else if (remoteHost === '192.168.2.101') {
    remoteUser = 'admin';
  } else if (settings.sshUser) {
    remoteUser = settings.sshUser;
  }

  const macAddress = settings.ledPanelMac || '';
  const statusStr = isActive ? 'active' : 'inactive';

  let text = customText;
  let color = customColor;

  if (!text) {
    text = isActive
      ? (settings.ledActiveText || "LIVESTREAM ON AIR")
      : (settings.ledInactiveText || "LIVESTREAM OFFLINE");
  }

  if (!color) {
    color = isActive
      ? (settings.ledActiveColor || "#ff0000")
      : (settings.ledInactiveColor || "#00ff00");
  }

  console.log(`[LED Control] OBS stream state changed to: ${statusStr}. Destination: ${remoteHost}, Text: "${text}", Color: "${color}". Detecting remote OS...`);

  // Sanitize inputs
  const sanitizedMac = macAddress ? sanitizeShellArg(macAddress) : '';
  const sanitizedText = text ? text.replace(/["\\$`]/g, '') : '';  // Remove quotes, backslashes and shell-expansion characters
  const sanitizedColor = color ? sanitizeShellArg(color) : '';

  // Detect remote OS
  return new Promise<boolean>((resolve) => {
    execSshCommand(remoteUser, remoteHost, 'cmd.exe /c echo windows', (detectErr, detectStdout) => {
      const isWindows = !detectErr && detectStdout.includes("windows");
      console.log(`[LED Control] Remote host OS detected: ${isWindows ? 'Windows' : 'macOS/Linux'}`);

      const sanitizedUser = sanitizeShellArg(remoteUser);
      const remoteScriptPath = isWindows
        ? `C:/Users/${sanitizedUser}/AppData/Local/Temp/led_control.py`
        : `/tmp/led_control.py`;
      const localScriptPath = path.join(process.cwd(), 'led_control.py');

      // Copy script to remote host
      execScpCommand(localScriptPath, remoteUser, remoteHost, remoteScriptPath, (err) => {
        if (err) {
          console.error(`[LED Control] scp copy failed: ${err.message}. Running remote script anyway...`);
        }

        // Build Python command arguments. Values are shell-quoted here
        // because the whole thing is joined into one command string sent
        // over SSH - an unquoted "--text LIVESTREAM ON AIR" gets split by
        // the remote shell into separate words, which argparse then
        // rejects as unrecognized positional arguments (exit code 2) -
        // confirmed live, every default text ("LIVESTREAM ON AIR"/
        // "LIVESTREAM OFFLINE") has spaces and hit exactly this.
        const quoteArg = (value: string) => `"${value}"`;
        const pythonArgs = ['--status', statusStr];
        if (sanitizedMac) {
          pythonArgs.push('--mac', quoteArg(sanitizedMac));
        }
        if (sanitizedText) {
          pythonArgs.push('--text', quoteArg(sanitizedText));
        }
        if (sanitizedColor) {
          pythonArgs.push('--color', quoteArg(sanitizedColor));
        }

        // Build remote command
        let remoteCommand: string;
        if (isWindows) {
          remoteCommand = `python "${remoteScriptPath}" ${pythonArgs.join(' ')}`;
        } else {
          // Try multiple Python paths on Unix-like systems
          const pyPath = remoteScriptPath;
          const pyArgs = pythonArgs.join(' ');
          remoteCommand = `if [ -f /opt/homebrew/bin/python3 ]; then /opt/homebrew/bin/python3 "${pyPath}" ${pyArgs}; elif [ -f /usr/local/bin/python3 ]; then /usr/local/bin/python3 "${pyPath}" ${pyArgs}; else python3 "${pyPath}" ${pyArgs}; fi`;
        }

        // Execute remote Python script
        execSshCommand(remoteUser, remoteHost, remoteCommand, (errRun, stdoutRun, stderrRun) => {
          if (errRun) {
            console.error(`[LED Control] ssh run failed: ${errRun.message}. Stderr: ${stderrRun}`);
            logActivity('led', `LED-scherm bijwerken mislukt (${statusStr})`, { error: errRun.message, host: remoteHost });
            resolve(false);
          } else {
            console.log(`[LED Control] Remote LED panel updated successfully: ${stdoutRun.trim()}`);
            logActivity('led', `LED-scherm bijgewerkt: "${text}"`, { status: statusStr, host: remoteHost });
            resolve(true);
          }
        });
      });
    });
  });
}

interface OBSState {
  connected: boolean;
  obsStats: any | null;
  serviceSettings: any | null;
  error: string | null;
  bitrateKbps: number;
  fps: number;
  recordStatus: any | null;
  scenes: any[] | null;
  currentProgramScene: string | null;
  currentPreviewScene: string | null;
  programSceneItems: any[] | null;
  audioInputs: any[] | null;
}

let obs: OBSWebSocket | null = null;
let state: OBSState = {
  connected: false,
  obsStats: null,
  serviceSettings: null,
  error: null,
  bitrateKbps: 0,
  fps: 0,
  recordStatus: null,
  scenes: null,
  currentProgramScene: null,
  currentPreviewScene: null,
  programSceneItems: null,
  audioInputs: null
};

let previousBytes = 0;
let previousPollTime = 0;
let pollTimer: NodeJS.Timeout | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let initialized = false;

async function pollStats() {
  if (!obs || !state.connected) return;
  try {
    const streamStatus = await obs.call('GetStreamStatus');
    const svcSettings = await obs.call('GetStreamServiceSettings');
    const stats = await obs.call('GetStats');
    const recordStatus = await obs.call('GetRecordStatus');
    const sceneList = await obs.call('GetSceneList');
    const inputList = await obs.call('GetInputList');
    
    // Process audio inputs
    const audioInputs = [];
    for (const input of inputList.inputs) {
      const kind = String(input.inputKind || '').toLowerCase();
      if (kind.includes('audio') || kind.includes('mic') || kind.includes('desktop')) {
        try {
          const vol = await obs.call('GetInputVolume', { inputName: String(input.inputName) });
          const mute = await obs.call('GetInputMute', { inputName: String(input.inputName) });
          audioInputs.push({
            inputName: input.inputName,
            inputKind: input.inputKind,
            volumeMul: vol.inputVolumeMul,
            volumeDb: vol.inputVolumeDb,
            inputMuted: mute.inputMuted
          });
        } catch (e) {}
      }
    }

    // Get current scene items
    let programSceneItems: any[] = [];
    if (sceneList.currentProgramSceneName) {
      try {
        const items = await obs.call('GetSceneItemList', { sceneName: sceneList.currentProgramSceneName });
        programSceneItems = items.sceneItems;
      } catch (e) {}
    }

    // Calculate bitrate
    const now = Date.now();
    let bitrateKbps = 0;
    if (previousPollTime > 0 && streamStatus.outputActive) {
      const timeDiff = (now - previousPollTime) / 1000;
      const bytesDiff = (streamStatus.outputBytes as number) - previousBytes;
      if (bytesDiff > 0 && timeDiff > 0) {
        bitrateKbps = Math.round((bytesDiff * 8) / 1000 / timeDiff);
      }
    }
    previousBytes = (streamStatus.outputBytes as number) || 0;
    previousPollTime = now;
    
    const isActive = streamStatus.outputActive === true;
    await updateLedState(isActive);

    state.obsStats = streamStatus;
    state.serviceSettings = svcSettings;
    state.fps = stats.activeFps as number;
    state.bitrateKbps = bitrateKbps;
    state.recordStatus = recordStatus;
    state.scenes = sceneList.scenes;
    state.currentProgramScene = sceneList.currentProgramSceneName;
    state.currentPreviewScene = sceneList.currentPreviewSceneName;
    state.programSceneItems = programSceneItems;
    state.audioInputs = audioInputs;
    
    state.error = null;
  } catch (err: any) {
    console.error('[OBS Manager] Poll error:', err.message);
    state.connected = false;
    state.obsStats = null;
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(connect, 6000);
}

async function connect() {
  const settings = getSettings();
  if (!settings.obsHost || !settings.obsPort) {
    state.error = 'OBS host/port not configured';
    return;
  }

  try {
    if (obs) {
      try { await obs.disconnect(); } catch (_) {}
    }
    obs = new OBSWebSocket();
    const url = `ws://${settings.obsHost}:${settings.obsPort}`;
    console.log(`[OBS Manager] Connecting to ${url}...`);

    await obs.connect(url, settings.obsPassword || undefined);
    state.connected = true;
    state.error = null;
    console.log('[OBS Manager] Connected to OBS.');

    obs.on('ConnectionClosed', () => {
      console.log('[OBS Manager] Connection closed. Scheduling reconnect...');
      state.connected = false;
      state.obsStats = null;
      state.recordStatus = null;
      state.scenes = null;
      state.audioInputs = null;
      state.programSceneItems = null;
      if (pollTimer) clearInterval(pollTimer);
      scheduleReconnect();
    });

    // Poll stats every 2 seconds
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(pollStats, 2000);
    await pollStats(); // immediate first fetch

  } catch (err: any) {
    state.connected = false;
    state.error = `Kan geen verbinding maken met OBS: ${err.message}`;
    state.obsStats = null;
    console.warn(`[OBS Manager] Connection failed: ${err.message}. Retrying in 6s...`);
    scheduleReconnect();
  }
}

/** Initialize the OBS manager (call once on server start) */
export function ensureOBSManager() {
  initYouTubeLivePolling();
  if (!initialized) {
    initialized = true;
    connect();
  }
}

/** Get the current cached OBS state */
export function getOBSState(): OBSState {
  ensureOBSManager();
  return { ...state };
}

/** Force reconnect (e.g. after settings change) */
export async function reconnectOBS() {
  initialized = true;
  if (pollTimer) clearInterval(pollTimer);
  if (reconnectTimer) clearTimeout(reconnectTimer);
  await connect();
}

/** Update OBS stream service settings */
export async function setOBSStreamConfig(config: {
  streamServiceType: string;
  streamServiceSettings: { server?: string; key: string; use_auth: boolean };
}) {
  if (!obs || !state.connected) {
    throw new Error('OBS is niet verbonden');
  }
  await obs.call('SetStreamServiceSettings', config);
  // Refresh cached settings
  state.serviceSettings = await obs.call('GetStreamServiceSettings');
  return state.serviceSettings;
}

/** Expose OBS instance for advanced specific API routes */
export function getOBSClient() {
  return obs;
}
