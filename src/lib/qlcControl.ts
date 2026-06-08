import { Client } from 'node-osc';
import { getSettings } from './settingsStore';

let qlcClient: Client | null = null;

export function sendQlcScene(sceneId: number) {
  const settings = getSettings();
  const host = settings.qlcHost || '127.0.0.1';
  const port = settings.qlcPort || 7700;

  try {
    if (!qlcClient) {
      qlcClient = new Client(host, port);
    }

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
    if (!qlcClient) {
      qlcClient = new Client(host, port);
    }

    console.log(`[QLC+] Sending OSC ${path} = ${value} to ${host}:${port}`);
    
    qlcClient.send(path, value, (err: any) => {
      if (err) console.error('[QLC+] Send Error:', err);
    });

  } catch (err) {
    console.error('[QLC+] Connection Error:', err);
    qlcClient = null;
  }
}

