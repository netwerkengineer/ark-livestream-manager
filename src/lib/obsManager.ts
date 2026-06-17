/**
 * obsManager.ts — Server-side OBS WebSocket singleton
 * 
 * Maintains a persistent ws:// connection from the Next.js server to OBS.
 * The browser polls /api/obs/status via HTTPS instead of connecting directly.
 * This avoids the browser wss:// requirement when OBS doesn't support TLS.
 */

import OBSWebSocket from 'obs-websocket-js';
import { getSettings } from './settingsStore';
import { exec } from 'child_process';
import path from 'path';

let lastStreamActiveState: boolean | null = null;

export function handleStreamStateChange(isActive: boolean, customText?: string | null, customColor?: string | null) {
  const settings = getSettings();
  if (!settings.ledPanelEnabled) return;

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

  // Detect remote OS
  const detectCmd = `ssh -o ConnectTimeout=3 -o StrictHostKeyChecking=no "${remoteUser}@${remoteHost}" "cmd.exe /c echo windows"`;

  exec(detectCmd, (detectErr, detectStdout) => {
    const isWindows = !detectErr && detectStdout.includes("windows");
    console.log(`[LED Control] Remote host OS detected: ${isWindows ? 'Windows' : 'macOS/Linux'}`);

    const remoteScriptPath = isWindows
      ? `C:/Users/${remoteUser}/AppData/Local/Temp/led_control.py`
      : `/tmp/led_control.py`;
    const pythonCmd = isWindows ? 'python' : 'python3';
    const localScriptPath = path.join(process.cwd(), 'led_control.py');

    // scp command
    const scpCmd = `scp -o ConnectTimeout=5 -o StrictHostKeyChecking=no "${localScriptPath}" "${remoteUser}@[${remoteHost}]:${remoteScriptPath}"`;
    
    // ssh run command
    let runCmd = "";
    let args = `--status ${statusStr}`;
    if (macAddress) args += ` --mac ${macAddress}`;
    if (text) args += ` --text \\"${text.replace(/"/g, '\\"')}\\"`;
    if (color) args += ` --color \\"${color}\\"`;
    
    if (isWindows) {
      runCmd = `ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no "${remoteUser}@${remoteHost}" "python \\"${remoteScriptPath}\\" ${args}"`;
    } else {
      runCmd = `ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no "${remoteUser}@${remoteHost}" "if [ -f /opt/homebrew/bin/python3 ]; then /opt/homebrew/bin/python3 \\"${remoteScriptPath}\\" ${args}; elif [ -f /usr/local/bin/python3 ]; then /usr/local/bin/python3 \\"${remoteScriptPath}\\" ${args}; else python3 \\"${remoteScriptPath}\\" ${args}; fi"`;
    }

    // Execute remote copy and run
    exec(scpCmd, (err, stdout, stderr) => {
      if (err) {
        console.error(`[LED Control] scp copy failed: ${err.message}. Running remote script anyway...`);
      }
      
      exec(runCmd, (errRun, stdoutRun, stderrRun) => {
        if (errRun) {
          console.error(`[LED Control] ssh run failed: ${errRun.message}. Stderr: ${stderrRun}`);
        } else {
          console.log(`[LED Control] Remote LED panel updated successfully: ${stdoutRun.trim()}`);
        }
      });
    });
  });
}

interface OBSState {
  connected: boolean;
  obsStats: any | null;
  serviceSettings: any | null;
  error: string | null;
}

let obs: OBSWebSocket | null = null;
let state: OBSState = {
  connected: false,
  obsStats: null,
  serviceSettings: null,
  error: null,
};
let pollTimer: NodeJS.Timeout | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let initialized = false;

async function pollStats() {
  if (!obs || !state.connected) return;
  try {
    const streamStatus = await obs.call('GetStreamStatus');
    const svcSettings = await obs.call('GetStreamServiceSettings');
    
    const isActive = streamStatus.outputActive === true;
    if (lastStreamActiveState !== isActive) {
      lastStreamActiveState = isActive;
      handleStreamStateChange(isActive);
    }

    state.obsStats = streamStatus;
    state.serviceSettings = svcSettings;
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
