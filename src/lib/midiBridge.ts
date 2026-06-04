import rtpmidi from 'rtpmidi';
import { getSettings } from './settingsStore';

// Use the global object to persist the MIDI session and peers array across Next.js re-compilations / worker threads
interface GlobalMidiContext {
  midiSession: any;
  activeMidiPeers: string[];
}

const globalMidi = global as unknown as GlobalMidiContext;

if (!globalMidi.activeMidiPeers) {
  globalMidi.activeMidiPeers = [];
}

export function getActiveMidiPeers() {
  if (!globalMidi.midiSession) return [];
  try {
    const names = globalMidi.midiSession.getStreams()
      .filter((s: any) => s.name)
      .map((s: any) => s.name.replace(/\0/g, '').trim());
    return Array.from(new Set(names));
  } catch (err) {
    console.error('Fout bij ophalen MIDI streams:', err);
    return Array.from(new Set(globalMidi.activeMidiPeers || []));
  }
}

export function initMidiBridge() {
  if (globalMidi.midiSession) return globalMidi.midiSession;

  const settings = getSettings();
  if (!settings.midiEnabled) {
    console.log('--- MIDI Bridge is uitgeschakeld in instellingen ---');
    return null;
  }

  const sessionName = settings.midiSessionName || 'livestream-Manager';
  
  try {
    globalMidi.midiSession = rtpmidi.manager.createSession({
      localName: sessionName,
      bonjourName: sessionName,
      port: 5006 // Standaard poort voor rtpMIDI
    });

    console.log(`--- MIDI Bridge Actief: "${sessionName}" op poort 5006 ---`);

    // Track active peers
    globalMidi.activeMidiPeers = [];
    globalMidi.midiSession.on('streamAdded', (event: any) => {
      const stream = event.stream;
      const cleanName = stream.name ? stream.name.replace(/\0/g, '').trim() : '';
      console.log(`[MIDI] Peer verbonden: ${cleanName} (${stream.address})`);
      if (cleanName && !globalMidi.activeMidiPeers.includes(cleanName)) {
        globalMidi.activeMidiPeers.push(cleanName);
      }
    });

    globalMidi.midiSession.on('streamRemoved', (event: any) => {
      const stream = event.stream;
      const cleanName = stream.name ? stream.name.replace(/\0/g, '').trim() : '';
      console.log(`[MIDI] Peer verbroken: ${cleanName}`);
      if (cleanName) {
        globalMidi.activeMidiPeers = globalMidi.activeMidiPeers.filter(p => p !== cleanName);
      }
    });

    globalMidi.midiSession.on('message', (deltaTime: number, message: number[]) => {
      // MIDI Message format: [status, data1, data2]
      // Bijv: Note On op kanaal 1: [144, noot, velocity]
      const [status, d1, d2] = message;
      
      console.log(`[MIDI] Ontvangen: Status ${status}, D1 ${d1}, D2 ${d2}`);

      // Hier koppelen we de MIDI aan de Companion knoppen
      handleMidiAction(status, d1, d2);
    });

    // Start auto-connect loop for target IPs
    startAutoConnectLoop(settings.midiAutoConnectIps);

    return globalMidi.midiSession;
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
    if (!globalMidi.midiSession) return;
    
    // Verkrijg de lijst met al verbonden of verbindende stream IP-adressen
    const activeIps = (globalMidi.midiSession.streams || [])
      .map((s: any) => {
        if (s.rinfo1 && s.rinfo1.address) return s.rinfo1.address;
        return s.targetAddress;
      })
      .filter((addr: any) => addr);
      
    targetIps.forEach(ip => {
      if (activeIps.includes(ip)) {
        // Al verbonden of momenteel aan het verbinden, sla deze over
        return;
      }
      
      console.log(`[MIDI Auto-Connect] Proberen te verbinden met ${ip}:5004...`);
      try {
        globalMidi.midiSession.connect({
          address: ip,
          port: 5004
        });
        
        // Tag de nieuw aangemaakte stream met het doel IP-adres
        const streams = globalMidi.midiSession.streams || [];
        const newStream = streams[streams.length - 1];
        if (newStream) {
          (newStream as any).targetAddress = ip;
        }
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
  if (!globalMidi.midiSession) {
    console.log('--- Kan MIDI niet verzenden: sessie is niet actief of geïnitialiseerd ---');
    return false;
  }
  
  try {
    globalMidi.midiSession.sendMessage([status, d1, d2]);
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
