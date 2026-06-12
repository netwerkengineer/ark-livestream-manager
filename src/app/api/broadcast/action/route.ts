import { NextRequest, NextResponse } from 'next/server';
import { getSettings } from '@/lib/settingsStore';
import { sendMidiMessage } from '@/lib/midiBridge';
import { isAuthorized } from "@/lib/authHelper";

export async function POST(request: NextRequest) {
  const authSession = await isAuthorized(request, undefined, "control");
  if (!authSession) {
    return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
  }

  try {
    const { page, row, col } = await request.json();
    const settings = getSettings();
    
    // Check of deze knop direct MIDI out moet sturen
    const button = settings.broadcastButtons?.find(
      btn => btn.page === page && btn.row === row && btn.col === col
    );

    if (button && button.midiOutNote !== undefined) {
      const channel = button.midiOutChannel || 1;
      const statusOn = 143 + channel; // 144 voor kanaal 1 (Note On)
      const statusOff = 127 + channel; // 128 voor kanaal 1 (Note Off)
      const note = button.midiOutNote;

      console.log(`[Broadcast API] Sending MIDI Out: Note ${note} on Channel ${channel}`);
      sendMidiMessage(statusOn, note, 127);

      // Stuur Note Off na 100ms om vastgelopen noten te voorkomen
      setTimeout(() => {
        sendMidiMessage(statusOff, note, 0);
      }, 100);
    }

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
