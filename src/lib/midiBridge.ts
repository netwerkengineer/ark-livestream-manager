import rtpmidi from 'rtpmidi';
import { getSettings } from './settingsStore';

let session: any = null;

export function initMidiBridge() {
  if (session) return session;

  const settings = getSettings();
  if (!settings.midiEnabled) {
    console.log('--- MIDI Bridge is uitgeschakeld in instellingen ---');
    return null;
  }

  const sessionName = settings.midiSessionName || 'Ark-Church-App';
  
  try {
    session = rtpmidi.manager.createSession({
      name: sessionName,
      port: 5006 // Standaard poort voor rtpMIDI
    });

    console.log(`--- MIDI Bridge Actief: "${sessionName}" op poort 5006 ---`);

    session.on('message', (deltaTime: number, message: number[]) => {
      // MIDI Message format: [status, data1, data2]
      // Bijv: Note On op kanaal 1: [144, noot, velocity]
      const [status, d1, d2] = message;
      
      console.log(`[MIDI] Ontvangen: Status ${status}, D1 ${d1}, D2 ${d2}`);

      // Hier koppelen we de MIDI aan de Companion knoppen
      handleMidiAction(status, d1, d2);
    });

    return session;
  } catch (err) {
    console.error('--- MIDI Bridge Error:', err);
    return null;
  }
}

async function handleMidiAction(status: number, d1: number, d2: number) {
  const settings = getSettings();
  
  // We zoeken of er een knop is die naar dit MIDI commando luistert
  // Voor nu doen we een simpele mapping: Note On op kanaal 1 
  // Noot 60 (C4) = Knop 1, Noot 61 = Knop 2, etc.
  
  if (status === 144 && d2 > 0) { // Note On & Velocity > 0
    const buttonToTrigger = settings.broadcastButtons.find(btn => btn.midiNote === d1);
    
    if (buttonToTrigger) {
      console.log(`[MIDI] Triggering knop: ${buttonToTrigger.name} via noot ${d1}`);
      
      try {
        const host = process.env.HOSTNAME || '127.0.0.1';
        await fetch(`http://${host}:${process.env.PORT || 3000}/api/broadcast/action`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            page: buttonToTrigger.page,
            row: buttonToTrigger.row,
            col: buttonToTrigger.col
          })
        });
      } catch (err) {
        console.error('[MIDI] Fout bij triggeren actie:', err);
      }
    }
  }
}
