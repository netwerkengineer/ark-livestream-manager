import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized } from '@/lib/authHelper';
import { getOBSClient } from '@/lib/obsManager';

export async function GET(req: NextRequest) {
  const authSession = await isAuthorized(req, undefined, "control");
  if (!authSession) {
    return NextResponse.json({ error: 'Niet geautoriseerd' }, { status: 401 });
  }

  const obs = getOBSClient();
  if (!obs) {
    return NextResponse.json({ error: 'OBS is niet verbonden' }, { status: 503 });
  }

  try {
    // Get the current program scene name
    const sceneList = await obs.call('GetSceneList');
    const programScene = sceneList.currentProgramSceneName;

    if (!programScene) {
      return NextResponse.json({ error: 'Geen actieve scene gevonden' }, { status: 404 });
    }

    // Capture screenshot
    const screenshot = await obs.call('GetSourceScreenshot', {
      sourceName: programScene as string,
      imageFormat: 'jpeg',
      imageWidth: 640,
      imageCompressionQuality: 80
    });

    return NextResponse.json({
      imageData: screenshot.imageData,
      sceneName: programScene
    });
  } catch (err: any) {
    console.error('Screenshot error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
