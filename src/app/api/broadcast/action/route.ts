import { NextResponse } from 'next/server';
import { getSettings } from '@/lib/settingsStore';

export async function POST(request: Request) {
  try {
    const { page, row, col } = await request.json();
    const settings = getSettings();
    
    // De URL voor de Companion API (v3/v4) om een knop 'in te drukken'
    const companionUrl = `http://${settings.companionHost}:${settings.companionPort}/api/location/${page}/${row}/${col}/press`;

    console.log(`[Broadcast API] Triggering Companion button: ${page}/${row}/${col} on ${settings.companionHost}`);

    const response = await fetch(companionUrl, {
      method: 'POST',
    });

    if (!response.ok) {
      throw new Error(`Companion API responded with status: ${response.status}`);
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[Broadcast API] Error triggering Companion:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
