import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized } from '@/lib/authHelper';
import { reconnectOBS } from '@/lib/obsManager';

export async function POST(req: NextRequest) {
  const authSession = await isAuthorized(req, undefined, "control");
  if (!authSession) {
    return NextResponse.json({ error: 'Niet geautoriseerd' }, { status: 401 });
  }
  await reconnectOBS();
  return NextResponse.json({ success: true });
}
