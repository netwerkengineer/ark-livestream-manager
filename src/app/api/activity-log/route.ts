import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized } from '@/lib/authHelper';
import { readActivity, ActivityCategory } from '@/lib/activityLog';

const VALID_CATEGORIES = new Set(['sync', 'plug', 'led', 'error', 'settings', 'system']);

export async function GET(req: NextRequest) {
  const authSession = await isAuthorized(req, 'admin');
  if (!authSession) {
    return NextResponse.json({ error: 'Niet geautoriseerd' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const limitParam = parseInt(searchParams.get('limit') || '100', 10);
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 500) : 100;
  const categoryParam = searchParams.get('category') || undefined;
  const category = categoryParam && VALID_CATEGORIES.has(categoryParam) ? (categoryParam as ActivityCategory) : undefined;
  const before = searchParams.get('before') || undefined;

  const entries = readActivity({ limit, category, before });
  return NextResponse.json({ success: true, entries });
}
