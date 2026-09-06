import { Client } from 'node-osc';
import { getSettings } from './settingsStore';

let qlcClient: Client | null = null;
let qlcClientHost: string | null = null;
let qlcClientPort: number | null = null;

// A Client created for one host/port silently keeps sending there forever,
// even after settings.qlcHost/qlcPort change later in the same process
// lifetime (e.g. a live settings.json edit without a restart) - UDP send()
// doesn't error on a wrong/unreachable destination, so this failed silently
// in production for weeks after qlcHost was corrected. Recreating whenever
// the target differs from what this client was built for closes that gap
// without giving up reusing the same client across repeated calls.
function getQlcClient(host: string, port: number): Client {
  if (!qlcClient || qlcClientHost !== host || qlcClientPort !== port) {
    qlcClient = new Client(host, port);
    qlcClientHost = host;
    qlcClientPort = port;
  }
  return qlcClient;
}

export function sendQlcScene(sceneId: number) {
  const settings = getSettings();
  const host = settings.qlcHost || '127.0.0.1';
  const port = settings.qlcPort || 7700;

  try {
    const qlcClient = getQlcClient(host, port);

    console.log(`[QLC+] Sending scene ${sceneId} to ${host}:${port} as /ark/light/scene/${sceneId}`);
    
    // We sturen een uniek signaal per scene naar /ark/light/scene/<id> met waarde 255 (aan/trigger)
    qlcClient.send(`/ark/light/scene/${sceneId}`, 255, (err: any) => {
      if (err) console.error('[QLC+] Send Error:', err);
    });

  } catch (err) {
    console.error('[QLC+] Connection Error:', err);
    qlcClient = null;
  }
}

export function sendQlcOsc(path: string, value: number) {
  const settings = getSettings();
  const host = settings.qlcHost || '127.0.0.1';
  const port = settings.qlcPort || 7700;

  try {
    const qlcClient = getQlcClient(host, port);

    console.log(`[QLC+] Sending OSC ${path} = ${value} to ${host}:${port}`);
    
    qlcClient.send(path, value, (err: any) => {
      if (err) console.error('[QLC+] Send Error:', err);
    });

  } catch (err) {
    console.error('[QLC+] Connection Error:', err);
    qlcClient = null;
  }
}

