import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized } from '@/lib/authHelper';
import { setOBSStreamConfig } from '@/lib/obsManager';

export async function POST(req: NextRequest) {
  const authSession = await isAuthorized(req);
  if (!authSession) {
    return NextResponse.json({ error: 'Niet geautoriseerd' }, { status: 401 });
  }

  try {
    const { streamServiceType, streamServiceSettings } = await req.json();
    const result = await setOBSStreamConfig({ streamServiceType, streamServiceSettings });
    return NextResponse.json({ success: true, serviceSettings: result });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
