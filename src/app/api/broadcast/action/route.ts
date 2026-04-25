import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const { page, row, col } = await request.json();
    
    // De URL voor de Companion API (v3/v4) om een knop 'in te drukken'
    // Formaat: http://127.0.0.1:8000/api/location/<page>/<row>/<column>/press
    const companionUrl = `http://127.0.0.1:8000/api/location/${page}/${row}/${col}/press`;

    console.log(`[Broadcast API] Triggering Companion button: ${page}/${row}/${col}`);

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
