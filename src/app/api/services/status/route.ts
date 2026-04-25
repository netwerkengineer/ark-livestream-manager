import { NextResponse } from 'next/server';
import net from 'net';
import dgram from 'dgram';
import { getSettings } from '@/lib/settingsStore';

async function checkTcp(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const client = new net.Socket();
    client.setTimeout(800);
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

async function checkUdp(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const client = dgram.createSocket('udp4');
    client.send('ping', port, host, (err) => {
      if (err) {
        client.close();
        resolve(false);
      } else {
        setTimeout(() => {
          client.close();
          resolve(true); 
        }, 100);
      }
    });
  });
}

export async function GET() {
  const settings = getSettings();

  const servicesToCheck = [
    { name: 'Companion', host: settings.companionHost, port: settings.companionPort, type: 'tcp' },
    { name: 'OBS', host: settings.obsHost, port: settings.obsPort, type: 'tcp' },
    { name: 'X32', host: settings.x32Host, port: settings.x32Port, type: 'udp' },
    { name: 'QLC+', host: settings.qlcHost, port: settings.qlcPort, type: 'udp' },
    { name: 'FreeShow', host: settings.freeShowHost, port: settings.freeShowPort, type: 'tcp' },
  ];

  const status = await Promise.all(
    servicesToCheck.map(async (service) => {
      const isUp = service.type === 'tcp' 
        ? await checkTcp(service.port, service.host)
        : await checkUdp(service.port, service.host);
      return { 
        name: service.name, 
        status: isUp ? 'UP' : 'DOWN',
        port: service.port,
        host: service.host
      };
    })
  );

  return NextResponse.json({ services: status });
}
