import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized } from '@/lib/authHelper';
import { getOBSClient } from '@/lib/obsManager';

export async function POST(req: NextRequest) {
  const authSession = await isAuthorized(req, undefined, "control");
  if (!authSession) {
    return NextResponse.json({ error: 'Niet geautoriseerd' }, { status: 401 });
  }

  const obs = getOBSClient();
  if (!obs) {
    return NextResponse.json({ error: 'OBS is niet verbonden' }, { status: 503 });
  }

  try {
    const { action, payload } = await req.json();

    switch (action) {
      case 'SetCurrentProgramScene':
        await obs.call('SetCurrentProgramScene', { sceneName: payload.sceneName });
        break;
      case 'SetSceneItemEnabled':
        // We need sceneItemId, which we get from programSceneItems, or we have to query it.
        // Assuming payload gives us sceneName and sceneItemId.
        await obs.call('SetSceneItemEnabled', {
          sceneName: payload.sceneName,
          sceneItemId: payload.sceneItemId,
          sceneItemEnabled: payload.sceneItemEnabled
        });
        break;
      case 'SetInputVolume':
        await obs.call('SetInputVolume', {
          inputName: payload.inputName,
          inputVolumeDb: payload.inputVolumeDb
        });
        break;
      case 'ToggleInputMute':
        await obs.call('ToggleInputMute', { inputName: payload.inputName });
        break;
      case 'ToggleStream':
        await obs.call('ToggleStream');
        break;
      case 'ToggleRecord':
        await obs.call('ToggleRecord');
        break;
      default:
        return NextResponse.json({ error: 'Ongeldige actie' }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('OBS Action error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
