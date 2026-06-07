/**
 * obsManager.ts — Server-side OBS WebSocket singleton
 * 
 * Maintains a persistent ws:// connection from the Next.js server to OBS.
 * The browser polls /api/obs/status via HTTPS instead of connecting directly.
 * This avoids the browser wss:// requirement when OBS doesn't support TLS.
 */

import OBSWebSocket from 'obs-websocket-js';
import { getSettings } from './settingsStore';

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
