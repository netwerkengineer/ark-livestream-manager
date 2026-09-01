import { NextRequest, NextResponse } from 'next/server';
import net from 'net';
import { execFile } from 'child_process';
import { getSettings } from '@/lib/settingsStore';
import { getActiveMidiPeers } from '@/lib/midiBridge';
import { isAuthorized } from "@/lib/authHelper";

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

async function checkPing(host: string): Promise<boolean> {
  // Plain UDP "did the send() call succeed" can't actually tell whether a
  // device is there - a send always succeeds regardless of whether
  // anything is listening, since UDP is connectionless. Some devices (like
  // the Atem) also don't answer an arbitrary probe packet even when
  // genuinely online. A real ICMP ping is what actually confirms the
  // device itself is reachable - same mechanism startup_pcs.py already
  // uses to wait for the Atem before launching OBS.
  if (!host) return false;
  return new Promise((resolve) => {
    execFile('ping', ['-c', '1', '-W', '2', host], (err) => {
      resolve(!err);
    });
  });
}

export async function GET(req: NextRequest) {
  const authSession = await isAuthorized(req);
  if (!authSession) {
    return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
  }

  const settings = getSettings();

  const servicesToCheck = [
    { name: 'Companion', host: settings.companionHost, port: settings.companionPort, type: 'tcp' },
    { name: 'OBS', host: settings.obsHost, port: settings.obsPort, type: 'tcp' },
    { name: 'X32', host: settings.x32Host, port: settings.x32Port, type: 'ping' },
    // The OSC port (settings.qlcPort) can't give a meaningful UP/DOWN signal:
    // UDP has no handshake, so checkUdp can only report whether send()
    // itself succeeded, which says nothing about anything actually
    // listening - and it hard-codes false whenever the host is
    // 127.0.0.1/localhost (assuming a Docker bridge network where that
    // could never reach the real host), which is wrong now that qlcHost is
    // deliberately 127.0.0.1 on every environment (see the qlcHost fix -
    // QLC+ runs alongside this app with network_mode: host, so localhost is
    // the correct, most reliable address). QLC+'s web server on 9999 is a
    // real TCP service that's always up whenever QLC+ itself is running,
    // regardless of which host string is configured.
    { name: 'QLC+', host: settings.qlcHost, port: 9999, type: 'tcp' },
    { name: 'FreeShow', host: settings.freeShowHost, port: settings.freeShowPort, type: 'tcp' },
    { name: 'Atem', host: settings.atemHost || '', port: 9910, type: 'ping' },
  ];

  const status = await Promise.all(
    servicesToCheck.map(async (service) => {
      const isUp = service.type === 'tcp'
        ? await checkTcp(service.port, service.host)
        : await checkPing(service.host);

      let statusLabel = isUp ? 'UP' : 'DOWN';
      if (isUp && service.type === 'ping') statusLabel = 'READY';

      return { 
        name: service.name, 
        status: statusLabel,
        port: service.port,
        host: service.host
      };
    })
  );

  // Add Tuya Control daemon status checking candidate IPs
  const tuyaHosts = [];
  if (settings.tuyaApiHost) tuyaHosts.push(settings.tuyaApiHost);
  tuyaHosts.push('127.0.0.1');
  if (settings.companionHost) tuyaHosts.push(settings.companionHost);
  tuyaHosts.push('172.17.0.1');
  const uniqueTuyaHosts = Array.from(new Set(tuyaHosts.filter(Boolean)));

  const tuyaChecks = await Promise.all(uniqueTuyaHosts.map(h => checkTcp(8088, h)));
  const isTuyaUp = tuyaChecks.some(val => val);

  status.push({
    name: 'Tuya Control',
    status: isTuyaUp ? 'UP' : 'DOWN',
    port: 8088,
    host: settings.tuyaApiHost || '127.0.0.1'
  });

  return NextResponse.json({ 
    services: status,
    midiPeers: getActiveMidiPeers()
  });
}
