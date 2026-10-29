import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { getSettings } from './settingsStore';
import { toFreeShowClientPath } from './freeshowUtils';
import sferenData from './sferen.json';
import { readFunctions } from './qlcFunctions';
import { triggerUrl } from './lightsTrigger';

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

// Een eigen scène of chase uit de lichtregie als licht bij een lied: slug "eigen-<functie-id>". Geen filmpje en geen Companion-knop;
// de FreeShow-actie roept /api/lights/trigger van deze app aan.
export const EIGEN_PREFIX = 'eigen-';
export function eigenId(slug: string | undefined | null): number | null {
  const m = /^eigen-(\d+)$/.exec(slug || '');
  return m ? Number(m[1]) : null;
}

function rid(n = 11): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from(crypto.randomBytes(n)).map(b => chars[b % chars.length]).join('');
}

export interface LichtKeuze { sfeer: string; achtergrond: string }

// Wat staat er nu op dit lied? Het licht komt uit de lichtactie (Companion-knop van een sfeer, of /api/lights/trigger voor een eigen
// scène of chase), de achtergrond uit de lege startdia: een Ark Visuals-filmpje hoort bij een sfeer, elk ander bestand in de
// mediamap is een eigen achtergrond (pad vanaf de mediamap, met schuine strepen). Leeg = er staat niets.
export async function readCurrentKeuze(filePath: string): Promise<LichtKeuze> {
  const out: LichtKeuze = { sfeer: '', achtergrond: '' };
  try {
    const raw = JSON.parse(await fs.readFile(filePath, 'utf-8'));
    const c = (Array.isArray(raw) ? raw[1] : raw) || {};
    const media = c.media || {};
    const layouts = JSON.stringify(c.layouts || {});
    const trigger = /\/api\/lights\/trigger\?id=(\d+)/.exec(layouts);
    const press = new RegExp(`/api/location/${COMPANION_PAGINA}/(\\d+)/(\\d+)/press`).exec(layouts);
    if (trigger) out.sfeer = EIGEN_PREFIX + trigger[1];
    else if (press) out.sfeer = SFEREN.find(x => x.knop === (Number(press[1]) - 2) * 8 + Number(press[2]))?.slug || '';
    for (const layout of Object.values<any>(c.layouts || {})) {
      const sls: any[] = layout.slides || [];
      if (!sls.length || !String(c.slides?.[sls[0].id]?.group || '').startsWith('Start')) continue;
      const m = media[sls[0].background];
      if (!m?.path) break;
      const hit = /Ark Visuals[\\/]([^\\/]+)\.mp4$/i.exec(String(m.path));
      if (hit) { if (!out.sfeer && getSfeer(hit[1])) out.sfeer = hit[1]; }
      else {
        const rel = /[\\/]Media[\\/](.+)$/i.exec(String(m.path));
        if (rel) out.achtergrond = rel[1].replace(/\\/g, '/');
      }
      break;
    }
    if (!out.sfeer && !out.achtergrond) {   // een oud lied zonder lichtactie maar met een sfeerfilmpje
      for (const m of Object.values<any>(media)) {
        const hit = /Ark Visuals[\\/]([^\\/]+)\.mp4$/i.exec(String(m?.path || ''));
        if (hit && getSfeer(hit[1])) { out.sfeer = hit[1]; break; }
      }
    }
  } catch { /* geen of onleesbaar bestand */ }
  return out;
}

// Zet de gekozen sfeer en/of achtergrond op de lege startdia van het lied: achtergrond + lichtactie. Maakt de startdia aan als die er
// nog niet is. De indeling "Tracks" wordt niet verschoven (de cuetabellen van Ark Tracks tellen de dia's daarvan).
// Alleen wat gekozen is verandert: zonder sfeer blijft het licht staan, zonder achtergrond blijft de achtergrond staan (bij een eigen
// scène of chase blijft ook het sfeerfilmpje staan). Een gekozen achtergrond (video of afbeelding) gaat voor het filmpje van de sfeer.
export async function applySfeerToShowFile(filePath: string, slug: string, achtergrond = ''): Promise<{ ok: boolean; note?: string }> {
  const eigen = eigenId(slug);
  const own = eigen !== null ? readFunctions().find(f => f.id === eigen && f.button) : undefined;
  if (eigen !== null && !own) return { ok: false, note: `Eigen scène of chase ${eigen} bestaat niet meer (of heeft geen knop in de lichtregie).` };
  const sfeer: Sfeer | undefined = slug && eigen === null ? getSfeer(slug) : undefined;
  if (slug && eigen === null && !sfeer) return { ok: false, note: `Onbekende sfeer "${slug}".` };
  const lichtGekozen = !!(sfeer || own);
  const settings = getSettings() as any;
  const notes: string[] = [];

  const raw = JSON.parse(await fs.readFile(filePath, 'utf-8'));
  if (!Array.isArray(raw) || !raw[1]) return { ok: false, note: 'Showbestand heeft een onverwacht formaat.' };
  const c = raw[1];
  c.media = c.media || {};

  // Achtergrond: een gekozen eigen bestand, anders het filmpje van de sfeer, anders blijft alles zoals het is
  const mediaRoot = settings.freeshowMediaPath || (settings.freeshowPath ? path.join(settings.freeshowPath, 'Media') : '');
  let serverFile = '';
  let ownBackground = false;
  if (achtergrond && mediaRoot) {
    const full = path.resolve(mediaRoot, achtergrond);
    if (full.startsWith(path.resolve(mediaRoot) + path.sep) && await fs.access(full).then(() => true).catch(() => false)) { serverFile = full; ownBackground = true; }
    else notes.push(`Achtergrond "${achtergrond}" is niet gevonden in de mediamap; de achtergrond is niet veranderd.`);
  }
  if (!ownBackground && sfeer && mediaRoot) {
    const video = path.join(mediaRoot, 'Motion backgrounds', 'Ark Visuals', `${sfeer.slug}.mp4`);
    if (await fs.access(video).then(() => true).catch(() => false)) serverFile = video;
    else notes.push(`Achtergrondvideo "${sfeer.slug}.mp4" ontbreekt in de mediamap; alleen het licht is gezet.`);
  }
  const backgroundChanges = !!serverFile || (!ownBackground && !!sfeer);   // een sfeer zonder bestand haalt het oude sfeerfilmpje wel weg
  const oldIds = backgroundChanges ? Object.keys(c.media).filter(k => /Ark Visuals/i.test(String(c.media[k]?.path || ''))) : [];
  oldIds.forEach(k => delete c.media[k]);
  let mid: string | null = null;
  if (serverFile) {
    const isImage = /\.(jpe?g|png|gif|webp|svg)$/i.test(serverFile);
    mid = (ownBackground ? 'bg' : 'ark' + sfeer!.slug.slice(0, 8)) + rid(ownBackground ? 8 : 3);
    c.media[mid] = {
      name: path.basename(serverFile),
      path: toFreeShowClientPath(serverFile, settings.freeshowPath, settings.freeshowClientPath),
      ...(isImage ? { type: 'image' } : { type: 'video', muted: true, loop: true })
    };
  }

  // Lichtactie (HTTP-verzoek naar de Companion-knop van deze sfeer)
  const companionUrl = String(settings.freeshowCompanionUrl || '').replace(/\/+$/, '');
  const lightUrl = own ? triggerUrl(own.id) : (companionUrl && sfeer ? `${companionUrl}/api/location/${companionKnopPad(sfeer)}/press` : '');
  const lightAction = lightUrl ? {
    id: rid(), name: `Licht: ${own ? own.name : sfeer!.naam}`, triggers: ['send_rest_command'],
    actionValues: { send_rest_command: { url: lightUrl, method: 'POST', contentType: '', payload: '' } },
    customActivation: '', midiEnabled: false
  } : null;
  if (lichtGekozen && !lightAction) notes.push('Geen Companion-adres voor FreeShow ingesteld (Instellingen); de lichtactie is niet gezet.');

  c.slides = c.slides || {};
  let startId: string | null = null;
  const replaced = new Set<string>();   // achtergronden die hier door een andere zijn vervangen; de lijst met media van de show ruimt ze op als niets ze meer gebruikt
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
    const prevBackground = start.background;
    if (backgroundChanges) { if (mid) start.background = mid; else delete start.background; if (prevBackground && prevBackground !== mid) replaced.add(prevBackground); }
    // Oude Ark-achtergronden op andere dia's weghalen (eigen, handmatig gekozen achtergronden blijven staan)
    sls.forEach((sl: any, i: number) => {
      if (i > 0 && oldIds.includes(sl.background)) delete sl.background;
      for (const ov of Object.values<any>(sl.children || {})) {
        if (ov && oldIds.includes(ov.background)) delete ov.background;
      }
    });
    if (lichtGekozen) {
      const acts = ((start.actions = start.actions || {}).slideActions = (start.actions.slideActions || []).filter((a: any) => !String(a.name || '').startsWith('Licht:')));
      if (lightAction) acts.push({ ...lightAction, id: rid() });
    }
    // Ook op de eerste tekstdia (net na de lege startdia): slaat de operator de startdia over, dan moet het licht toch wisselen.
    // De Companion-knop zet de scène aan (geen wisselknop), dus twee keer indrukken geeft hetzelfde resultaat.
    const firstText = sls[1];
    if (firstText) {
      if (lichtGekozen) {
        const textActs = ((firstText.actions = firstText.actions || {}).slideActions = (firstText.actions.slideActions || []).filter((a: any) => !String(a.name || '').startsWith('Licht:')));
        if (lightAction) textActs.push({ ...lightAction, id: rid() });
      }
      // Zelfde met de achtergrond; een eigen, handmatig gekozen achtergrond op die dia blijft staan (oude Ark-achtergronden zijn hierboven al weg)
      if (mid && (!firstText.background || firstText.background === prevBackground)) { if (firstText.background && firstText.background !== mid) replaced.add(firstText.background); firstText.background = mid; }
    }
  }

  // Een vervangen achtergrond blijft in de mediabestanden van de show staan; weghalen als geen dia of ander onderdeel er nog naar verwijst
  // (het bestand zelf in de mediamap blijft bestaan)
  if (replaced.size) {
    const { media, ...rest } = c;
    const rest_ = JSON.stringify(rest);
    for (const id of replaced) if (c.media[id] && !rest_.includes(`"${id}"`)) delete c.media[id];
  }

  c.timestamps = { ...(c.timestamps || {}), modified: Date.now() };
  // Via tijdelijk bestand en hernoemen: sommige showbestanden zijn van een andere gebruiker op de NFS-schijf
  const tmp = path.join(path.dirname(filePath), `.ark-tmp-${rid(6)}`);
  await fs.writeFile(tmp, JSON.stringify(raw, null, 2));
  await fs.chmod(tmp, 0o666).catch(() => {});
  await fs.rename(tmp, filePath);
  return { ok: true, note: notes.length ? notes.join(' ') : undefined };
}
