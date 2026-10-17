import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getSettings } from '@/lib/settingsStore';
import { isAuthorized } from "@/lib/authHelper";
export const dynamic = 'force-dynamic';

// "Starten en stoppen"-knop van een pc (dashboard): kiest zelf op basis van de ECHTE stand van de stekker.
//
// Waarom niet via Companion: die knop is een wisselknop met een eigen, onthouden stand. Zet iets anders de stekker aan of uit
// (de automatische sync, de thumbnail-sync, de Tuya-app, een afsluiting vanaf de pc zelf), dan loopt die stand uit de pas en
// gaf de eerstvolgende klik de verkeerde opdracht (afsluiten terwijl de pc al uit was; pas de tweede klik zette hem aan).
//
// Stekker uit  -> opstartsequentie (/on)        Stekker aan -> afsluitsequentie (/shutdown)
// Een sequentie die nog loopt, of een sync die de stekker zelf bedient, wordt niet onderbroken.

const lastAction = new Map<string, { action: 'on' | 'off'; at: number }>();
const STARTUP_BUSY_MS = 120_000;   // opstarten: de stekker staat meteen aan, maar de pc is nog niet klaar
const SHUTDOWN_BUSY_MS = 90_000;   // afsluiten: stekker blijft aan tot de pc is uitgezet (ca. 35 s + marge)
const SYNC_MAX_AGE_MS = 30 * 60_000;

function daemonHosts(): string[] {
  const settings = getSettings() as any;
  const raw: string[] = [];
  if (settings.tuyaApiHost) raw.push(settings.tuyaApiHost);
  raw.push('127.0.0.1');
  if (settings.companionHost) raw.push(settings.companionHost);
  raw.push('172.17.0.1');
  return Array.from(new Set(raw.filter(Boolean)));
}

async function daemon(pathAndQuery: string, timeoutMs = 5000): Promise<Response | null> {
  for (const host of daemonHosts()) {
    try {
      const res = await fetch(`http://${host}:8088${pathAndQuery}`, { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
      if (res.ok) return res;
    } catch {
      // volgende host proberen
    }
  }
  return null;
}

function syncRunning(): boolean {
  try {
    const file = path.join(process.cwd(), 'data', 'sync_status.json');
    const status = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (!status.running) return false;
    const started = Date.parse(String(status.started_at || '').replace(' ', 'T'));
    return !Number.isFinite(started) || Date.now() - started < SYNC_MAX_AGE_MS;
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  const authSession = await isAuthorized(req, undefined, "control");
  if (!authSession) {
    return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
  }

  let body: any = {};
  try { body = await req.json(); } catch { /* leeg */ }
  const plugId = String(body.plugId || '');
  const requested = body.action === 'on' || body.action === 'off' ? body.action as 'on' | 'off' : 'toggle';

  const settings = getSettings() as any;
  const known = (settings.tuyaPlugs || []).some((p: any) => p.id === plugId);
  if (!plugId || !known) {
    return NextResponse.json({ success: false, error: 'Onbekende stekker' }, { status: 400 });
  }

  if (syncRunning()) {
    return NextResponse.json({ success: false, busy: true, message: 'Er loopt een sync die de stekker zelf bedient. Probeer het over een paar minuten opnieuw.' }, { status: 409 });
  }

  const statusRes = await daemon('/status_json', 4000);
  if (!statusRes) {
    return NextResponse.json({ success: false, message: 'Tuya-server niet bereikbaar.' }, { status: 502 });
  }
  const plugs: any[] = await statusRes.json();
  const plug = plugs.find(p => p.id === plugId);
  if (!plug || !plug.is_online) {
    return NextResponse.json({ success: false, message: 'Stekker is offline.' }, { status: 502 });
  }

  const state: 'on' | 'off' = plug.state === 'on' ? 'on' : 'off';
  const target: 'on' | 'off' = requested === 'toggle' ? (state === 'on' ? 'off' : 'on') : requested;

  if (target === state) {
    return NextResponse.json({ success: true, noop: true, state, message: state === 'on' ? 'Stekker staat al aan.' : 'Stekker staat al uit.' });
  }

  const last = lastAction.get(plugId);
  if (last && target === 'off' && last.action === 'on' && Date.now() - last.at < STARTUP_BUSY_MS) {
    return NextResponse.json({ success: false, busy: true, state, message: 'De pc is nog aan het opstarten; wacht even met afsluiten.' }, { status: 409 });
  }
  if (last && target === 'off' && last.action === 'off' && Date.now() - last.at < SHUTDOWN_BUSY_MS) {
    return NextResponse.json({ success: false, busy: true, state, message: 'De pc wordt al afgesloten.' }, { status: 409 });
  }

  const endpoint = target === 'on' ? '/on' : '/shutdown';
  const res = await daemon(`${endpoint}?plug=${encodeURIComponent(plugId)}`, 8000);
  if (!res) {
    return NextResponse.json({ success: false, message: 'Opdracht kon niet naar de Tuya-server worden gestuurd.' }, { status: 502 });
  }

  lastAction.set(plugId, { action: target, at: Date.now() });
  return NextResponse.json({
    success: true,
    plugId,
    previousState: state,
    action: target,
    message: target === 'on' ? 'Opstartsequentie gestart.' : 'Afsluitsequentie gestart.',
  });
}
