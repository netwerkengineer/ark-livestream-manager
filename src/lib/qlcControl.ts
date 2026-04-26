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

    console.log(`[QLC+] Sending scene ${sceneId} to ${host}:${port}`);
    
    // We sturen een signaal naar /ark/light/scene met het nummer van de scene
    qlcClient.send('/ark/light/scene', sceneId, (err: any) => {
      if (err) console.error('[QLC+] Send Error:', err);
    });

  } catch (err) {
    console.error('[QLC+] Connection Error:', err);
    qlcClient = null;
  }
}
