import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized } from '@/lib/authHelper';
import { getOBSState, ensureOBSManager } from '@/lib/obsManager';

ensureOBSManager();

export async function GET(req: NextRequest) {
  const authSession = await isAuthorized(req);
  if (!authSession) {
    return NextResponse.json({ error: 'Niet geautoriseerd' }, { status: 401 });
  }
  return NextResponse.json(getOBSState());
}
