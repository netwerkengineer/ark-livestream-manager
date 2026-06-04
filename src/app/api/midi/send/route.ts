import { NextResponse } from 'next/server';
import { sendMidiMessage } from '@/lib/midiBridge';

export async function POST(request: Request) {
  try {
    const { status, d1, d2 } = await request.json();

    if (status === undefined || d1 === undefined || d2 === undefined) {
      return NextResponse.json(
        { success: false, error: 'Parameters "status", "d1" en "d2" zijn verplicht.' },
        { status: 400 }
      );
    }

    const success = sendMidiMessage(Number(status), Number(d1), Number(d2));

    if (success) {
      return NextResponse.json({ success: true });
    } else {
      return NextResponse.json(
        { success: false, error: 'MIDI Bridge is niet actief of het verzenden is mislukt.' },
        { status: 500 }
      );
    }
  } catch (error: any) {
    console.error('[MIDI API] Fout bij verwerken MIDI-send verzoek:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
