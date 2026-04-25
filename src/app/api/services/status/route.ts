import { NextResponse } from 'next/server';
import net from 'net';
import dgram from 'dgram';

const SERVICES = [
  { name: 'Companion', port: 8000, type: 'tcp' },
  { name: 'OBS', port: 4455, type: 'tcp' },
  { name: 'X32', port: 10023, type: 'udp' },
  { name: 'QLC+', port: 7700, type: 'udp' },
];

async function checkTcp(port: number, host: string = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const client = new net.Socket();
    client.setTimeout(500);
    client.on('connect', () => {
      client.destroy();
      resolve(true);
    });
    client.on('error', () => {
      client.destroy();
      resolve(false);
    });
    client.on('timeout', () => {
      client.destroy();
      resolve(false);
    });
    client.connect(port, host);
  });
}

async function checkUdp(port: number, host: string = '127.0.0.1'): Promise<boolean> {
  // UDP is connectionless, so we just check if the port is reachable or "not refused"
  // This is a basic check.
  return new Promise((resolve) => {
    const client = dgram.createSocket('udp4');
    client.send('ping', port, host, (err) => {
      if (err) {
        client.close();
        resolve(false);
      } else {
        // We assume sent is OK, real check would need a response
        setTimeout(() => {
          client.close();
          resolve(true); 
        }, 100);
      }
    });
  });
}

export async function GET() {
  const status = await Promise.all(
    SERVICES.map(async (service) => {
      const isUp = service.type === 'tcp' 
        ? await checkTcp(service.port)
        : await checkUdp(service.port);
      return { 
        name: service.name, 
        status: isUp ? 'UP' : 'DOWN',
        port: service.port
      };
    })
  );

  return NextResponse.json({ services: status });
}
