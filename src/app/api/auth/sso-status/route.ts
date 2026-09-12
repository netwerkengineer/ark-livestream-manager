import { NextResponse } from 'next/server';
import { getSettings } from '@/lib/settingsStore';

// Deliberately unauthenticated (unlike /api/settings) - LoginScreen.tsx
// needs to know whether to show an SSO button, and its label, before
// anyone is logged in. Only ever returns the two fields a login screen
// needs, never the issuer URL or client secret.
export async function GET() {
  const settings = getSettings();
  return NextResponse.json({
    enabled: !!settings.ssoEnabled,
    providerName: settings.ssoProviderName || 'Team-login'
  });
}
