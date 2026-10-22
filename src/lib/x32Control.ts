import dgram from 'node:dgram';
import { getSettings } from './settingsStore';

// Minimal OSC towards the Behringer X32 (UDP, port from the settings). Only what the virtual soundcheck needs:
// read and set the REC/PLAY routing switch (/config/routing/routswitch). In PLAY the 32 channels take their input
// from the USB card (the recording played back by REAPER) instead of the stage box and microphones.

export type X32Routing = 'REC' | 'PLAY';

const ROUTSWITCH = '/config/routing/routswitch';

const pad4 = (b: Buffer) => Buffer.concat([b, Buffer.alloc(4 - (b.length % 4))]);
const oscString = (s: string) => pad4(Buffer.from(s, 'utf8'));

function oscMessage(path: string, int?: number): Buffer {
  if (int === undefined) return Buffer.concat([oscString(path), oscString(',')]);
  const arg = Buffer.alloc(4);
  arg.writeInt32BE(int);
  return Buffer.concat([oscString(path), oscString(',i'), arg]);
}

// Reply: /config/routing/routswitch ,i <n>  (the X32 answers to the sender's address and port)
function parseIntReply(data: Buffer, path: string): number | null {
  const end = data.indexOf(0);
  if (end < 0 || data.toString('utf8', 0, end) !== path) return null;
  const tagStart = Math.floor(end / 4 + 1) * 4;
  const tagEnd = data.indexOf(0, tagStart);
  if (tagEnd < 0 || data.toString('utf8', tagStart, tagEnd) !== ',i') return null;
  const argStart = Math.floor(tagEnd / 4 + 1) * 4;
  return argStart + 4 <= data.length ? data.readInt32BE(argStart) : null;
}

function request(message: Buffer, replyPath: string, timeoutMs = 1500): Promise<number> {
  const { x32Host, x32Port } = getSettings();
  return new Promise((resolve, reject) => {
    const sock = dgram.createSocket('udp4');
    const done = (fn: () => void) => { clearTimeout(timer); sock.close(); fn(); };
    const timer = setTimeout(() => done(() => reject(new Error(`De X32 (${x32Host}) antwoordt niet. Staat hij aan en is het IP-adres in de instellingen goed?`))), timeoutMs);
    sock.on('message', data => {
      const v = parseIntReply(data, replyPath);
      if (v !== null) done(() => resolve(v));
    });
    sock.on('error', err => done(() => reject(err)));
    sock.send(message, x32Port || 10023, x32Host, err => { if (err) done(() => reject(err)); });
  });
}

export async function getX32Routing(): Promise<X32Routing> {
  const v = await request(oscMessage(ROUTSWITCH), ROUTSWITCH);
  return v === 1 ? 'PLAY' : 'REC';
}

function send(message: Buffer): Promise<void> {
  const { x32Host, x32Port } = getSettings();
  return new Promise((resolve, reject) => {
    const sock = dgram.createSocket('udp4');
    sock.on('error', err => { sock.close(); reject(err); });
    sock.send(message, x32Port || 10023, x32Host, err => { sock.close(); err ? reject(err) : resolve(); });
  });
}

// Sets the switch and reads it back: only reports success when the X32 really changed (a set is not answered)
export async function setX32Routing(mode: X32Routing): Promise<X32Routing> {
  await getX32Routing();                                   // the X32 must be reachable, otherwise a clear message
  await send(oscMessage(ROUTSWITCH, mode === 'PLAY' ? 1 : 0));
  await new Promise(r => setTimeout(r, 250));
  const now = await getX32Routing();
  if (now !== mode) throw new Error(`De X32 bleef op ${now} staan. Zet het om op de tafel (Routing → Home → REC/PLAY).`);
  return now;
}
