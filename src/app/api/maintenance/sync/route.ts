import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized } from "@/lib/authHelper";
import { triggerFreeShowSync } from '@/lib/syncTrigger';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const authSession = await isAuthorized(req, undefined, 'freeshow');
  if (!authSession) {
    return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
  }

  let targetKeys: string[] | undefined;
  try {
    const body = await req.json();
    if (Array.isArray(body?.targetKeys) && body.targetKeys.length > 0) {
      targetKeys = body.targetKeys.filter((k: unknown) => typeof k === 'string');
    }
  } catch {
    // No/empty body is fine - falls back to syncing every enabled target.
  }

  const result = await triggerFreeShowSync({ targetKeys });

  if (!result.success) {
    return NextResponse.json({
      error: result.message || 'Could not connect to Tuya HTTP control server to trigger sync'
    }, { status: 502 });
  }

  return NextResponse.json({ success: true, message: result.message });
}
