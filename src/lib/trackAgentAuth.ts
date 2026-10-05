import { NextRequest } from 'next/server';
import crypto from 'crypto';
import { getSettings } from './settingsStore';
import { touchAgent } from './trackLibrary';

// The track-computer agent authenticates with a shared token from the
// settings (Bearer header), not with a user login.
export function isAgentAuthorized(req: NextRequest): boolean {
  const expected = getSettings().trackAgentToken || '';
  const given = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (expected.length < 16 || given.length !== expected.length) return false;
  const ok = crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  if (ok) {
    touchAgent(req.headers.get('x-agent-host') || undefined, req.headers.get('x-agent-version') || undefined);
  }
  return ok;
}
