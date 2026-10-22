import fs from 'fs/promises';
import path from 'path';
import { getSettings } from './settingsStore';
import { getBijbelStijl, isBijbelStijl, STANDAARD_BIJBELSTIJL } from './bijbelstijlen';

// Server-kant van de bijbelstijlen: welke stijl geldt er, en staat de achtergrondvideo (Ark Visuals/bijbel-<slug>.mp4) klaar?

/** De stijl voor een dienst: de gekozen stijl, anders "klassiek". */
export function resolveBijbelStijlSlug(gekozen?: string | null): string {
  return isBijbelStijl(gekozen) ? gekozen : STANDAARD_BIJBELSTIJL;
}

/** Pad (serverkant) van de achtergrondvideo, of null als de video ontbreekt in de mediamap. */
export async function bijbelAchtergrondPad(slug: string): Promise<string | null> {
  const settings = getSettings() as any;
  const mediaRoot = settings.freeshowMediaPath || (settings.freeshowPath ? path.join(settings.freeshowPath, 'Media') : '');
  if (!mediaRoot) return null;
  const file = path.join(mediaRoot, 'Motion backgrounds', 'Ark Visuals', `${getBijbelStijl(slug).video}.mp4`);
  return fs.access(file).then(() => file, () => null);
}
