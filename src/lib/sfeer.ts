import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { getSettings } from './settingsStore';
import { toFreeShowClientPath } from './freeshowUtils';
import sferenData from './sferen.json';

// Een "sfeer" is een achtergrondvideo plus een lichtschema (QLC+-scène via een Companion-knop).
// De lijst staat in sferen.json (ook gebruikt door scripts/visuals) en de filmpjes in
// <FreeShow-map>/Media/Motion backgrounds/Ark Visuals/<slug>.mp4.

export interface Sfeer {
  slug: string;
  naam: string;
  main: string;
  accent: string;
  wit: number;
  knop: number; // volgnummer van de Companion-knop op de pagina "Licht" (acht per rij, vanaf rij 2)
}

// Companion: eigen pagina "Licht" met de knoppen (rij 0: schakelaar automatisch licht, rij 1: losse kleuren, vanaf rij 2: sferen)
export const COMPANION_PAGINA = 2;
export function companionKnopPad(s: Sfeer): string {
  return `${COMPANION_PAGINA}/${2 + Math.floor(s.knop / 8)}/${s.knop % 8}`;
}

export const SFEREN: Sfeer[] = sferenData as Sfeer[];

export function getSfeer(slug: string | undefined | null): Sfeer | undefined {
  return slug ? SFEREN.find(s => s.slug === slug) : undefined;
}

function rid(n = 11): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from(crypto.randomBytes(n)).map(b => chars[b % chars.length]).join('');
}

// Welke sfeer staat er nu in dit lied (afgeleid uit de achtergrondvideo)? Leeg als het lied er nog geen heeft.
export async function readCurrentSfeer(filePath: string): Promise<string> {
  try {
    const raw = JSON.parse(await fs.readFile(filePath, 'utf-8'));
    const media = (Array.isArray(raw) ? raw[1] : raw)?.media || {};
    for (const m of Object.values<any>(media)) {
      const hit = /Ark Visuals[\\/]([^\\/]+)\.mp4$/i.exec(String(m?.path || ''));
      if (hit && getSfeer(hit[1])) return hit[1];
    }
  } catch { /* geen of onleesbaar bestand */ }
  return '';
}

// Zet de gekozen sfeer op de lege startdia van het lied: achtergrond + lichtactie. Maakt de startdia aan als die er nog
// niet is. De indeling "Tracks" wordt niet verschoven (de cuetabellen van Ark Tracks tellen de dia's daarvan).
export async function applySfeerToShowFile(filePath: string, slug: string): Promise<{ ok: boolean; note?: string }> {
  const sfeer = getSfeer(slug);
  if (!sfeer) return { ok: false, note: `Onbekende sfeer "${slug}".` };
  const settings = getSettings() as any;
  const notes: string[] = [];

  const raw = JSON.parse(await fs.readFile(filePath, 'utf-8'));
  if (!Array.isArray(raw) || !raw[1]) return { ok: false, note: 'Showbestand heeft een onverwacht formaat.' };
  const c = raw[1];
  c.media = c.media || {};

  // Achtergrond
  const mediaRoot = settings.freeshowMediaPath || (settings.freeshowPath ? path.join(settings.freeshowPath, 'Media') : '');
  const serverVideo = mediaRoot ? path.join(mediaRoot, 'Motion backgrounds', 'Ark Visuals', `${sfeer.slug}.mp4`) : '';
  const videoExists = serverVideo ? await fs.access(serverVideo).then(() => true).catch(() => false) : false;
  const oldIds = Object.keys(c.media).filter(k => /Ark Visuals/i.test(String(c.media[k]?.path || '')));
  oldIds.forEach(k => delete c.media[k]);
  let mid: string | null = null;
  if (videoExists) {
    mid = 'ark' + sfeer.slug.slice(0, 8) + rid(3);
    c.media[mid] = {
      name: `${sfeer.slug}.mp4`,
      path: toFreeShowClientPath(serverVideo, settings.freeshowPath, settings.freeshowClientPath),
      type: 'video', muted: true, loop: true
    };
  } else {
    notes.push(`Achtergrondvideo "${sfeer.slug}.mp4" ontbreekt in de mediamap; alleen het licht is gezet.`);
  }

  // Lichtactie (HTTP-verzoek naar de Companion-knop van deze sfeer)
  const companionUrl = String(settings.freeshowCompanionUrl || '').replace(/\/+$/, '');
  const lightAction = companionUrl ? {
    id: rid(), name: `Licht: ${sfeer.naam}`, triggers: ['send_rest_command'],
    actionValues: { send_rest_command: { url: `${companionUrl}/api/location/${companionKnopPad(sfeer)}/press`, method: 'POST', contentType: '', payload: '' } },
    customActivation: '', midiEnabled: false
  } : null;
  if (!lightAction) notes.push('Geen Companion-adres voor FreeShow ingesteld (Instellingen); de lichtactie is niet gezet.');

  c.slides = c.slides || {};
  let startId: string | null = null;
  for (const layout of Object.values<any>(c.layouts || {})) {
    const sls: any[] = layout.slides || [];
    if (!sls.length) continue;
    const firstDef = c.slides[sls[0].id] || {};
    const isStart = String(firstDef.group || '').startsWith('Start');
    if (layout.name === 'Tracks' && !isStart) continue;
    if (!isStart) {
      if (!startId) {
        startId = rid();
        c.slides[startId] = { group: 'Start (tracks)', color: '#334155', settings: {}, notes: 'Lege startdia: hier hangen achtergrond, licht en stijl aan.', items: [], globalGroup: null };
      }
      sls.unshift({ id: startId });
      if (sls[1]?.actions) { sls[0].actions = sls[1].actions; delete sls[1].actions; } // acties van de eerste tekstdia verhuizen mee
    }
    const start = sls[0];
    if (mid) start.background = mid; else delete start.background;
    // Oude Ark-achtergronden op andere dia's weghalen (eigen, handmatig gekozen achtergronden blijven staan)
    sls.forEach((sl: any, i: number) => {
      if (i > 0 && oldIds.includes(sl.background)) delete sl.background;
      for (const ov of Object.values<any>(sl.children || {})) {
        if (ov && oldIds.includes(ov.background)) delete ov.background;
      }
    });
    const acts = ((start.actions = start.actions || {}).slideActions = (start.actions.slideActions || []).filter((a: any) => !String(a.name || '').startsWith('Licht:')));
    if (lightAction) acts.push({ ...lightAction, id: rid() });
    // Ook op de eerste tekstdia (net na de lege startdia): slaat de operator de startdia over, dan moet het licht toch wisselen.
    // De Companion-knop zet de scène aan (geen wisselknop), dus twee keer indrukken geeft hetzelfde resultaat.
    const firstText = sls[1];
    if (firstText) {
      const textActs = ((firstText.actions = firstText.actions || {}).slideActions = (firstText.actions.slideActions || []).filter((a: any) => !String(a.name || '').startsWith('Licht:')));
      if (lightAction) textActs.push({ ...lightAction, id: rid() });
      // Zelfde met de achtergrond; een eigen, handmatig gekozen achtergrond op die dia blijft staan (oude Ark-achtergronden zijn hierboven al weg)
      if (mid && !firstText.background) firstText.background = mid;
    }
  }

  c.timestamps = { ...(c.timestamps || {}), modified: Date.now() };
  // Via tijdelijk bestand en hernoemen: sommige showbestanden zijn van een andere gebruiker op de NFS-schijf
  const tmp = path.join(path.dirname(filePath), `.ark-tmp-${rid(6)}`);
  await fs.writeFile(tmp, JSON.stringify(raw, null, 2));
  await fs.chmod(tmp, 0o666).catch(() => {});
  await fs.rename(tmp, filePath);
  return { ok: true, note: notes.length ? notes.join(' ') : undefined };
}
