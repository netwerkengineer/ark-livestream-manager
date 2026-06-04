import rtpmidi from 'rtpmidi';
import { getSettings } from './settingsStore';

let activePeers: string[] = [];
let session: any = null;

export function getActiveMidiPeers() {
  return activePeers;
}

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

    // Track active peers
    activePeers = [];
    session.on('peerAdded', (peer: any) => {
      console.log(`[MIDI] Peer verbonden: ${peer.name} (${peer.address})`);
      if (!activePeers.includes(peer.name)) {
        activePeers.push(peer.name);
      }
    });

    session.on('peerRemoved', (peer: any) => {
      console.log(`[MIDI] Peer verbroken: ${peer.name}`);
      activePeers = activePeers.filter(p => p !== peer.name);
    });

    session.on('message', (deltaTime: number, message: number[]) => {
      // MIDI Message format: [status, data1, data2]
      // Bijv: Note On op kanaal 1: [144, noot, velocity]
      const [status, d1, d2] = message;
      
      console.log(`[MIDI] Ontvangen: Status ${status}, D1 ${d1}, D2 ${d2}`);

      // Hier koppelen we de MIDI aan de Companion knoppen
      handleMidiAction(status, d1, d2);
    });

    // Start auto-connect loop for target IPs
    startAutoConnectLoop(settings.midiAutoConnectIps);

    return session;
  } catch (err) {
    console.error('--- MIDI Bridge Error:', err);
    return null;
  }
}

let autoConnectInterval: NodeJS.Timeout | null = null;

function startAutoConnectLoop(ipsString: string) {
  if (autoConnectInterval) {
    clearInterval(autoConnectInterval);
    autoConnectInterval = null;
  }
  
  if (!ipsString) return;
  
  const parseIps = (str: string) => {
    return str
      .split(',')
      .map(ip => ip.trim())
      .filter(ip => ip.length > 0);
  };
  
  const targetIps = parseIps(ipsString);
  if (targetIps.length === 0) return;
  
  const attemptConnections = () => {
    if (!session) return;
    
    targetIps.forEach(ip => {
      console.log(`[MIDI Auto-Connect] Proberen te verbinden met ${ip}:5004...`);
      try {
        session.connect({
          address: ip,
          port: 5004
        });
      } catch (err) {
        console.error(`[MIDI Auto-Connect] Fout bij verbinden met ${ip}:5004:`, err);
      }
    });
  };
  
  // Voer direct uit bij start
  attemptConnections();
  
  // Herhaal elke 15 seconden
  autoConnectInterval = setInterval(attemptConnections, 15000);
}

export function sendMidiMessage(status: number, d1: number, d2: number) {
  if (!session) {
    console.log('--- Kan MIDI niet verzenden: sessie is niet actief of geïnitialiseerd ---');
    return false;
  }
  
  try {
    session.sendMessage([status, d1, d2]);
    console.log(`[MIDI] Verzonden naar deelnemers: Status ${status}, D1 ${d1}, D2 ${d2}`);
    return true;
  } catch (err) {
    console.error('[MIDI] Fout bij verzenden MIDI-bericht:', err);
    return false;
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
