import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { withRevertStyleAction } from '@/lib/freeshow';

// Zet de stijlwissel naar de liederenstijl ook in het showbestand zelf. FreeShow speelt een lied dat al in de bibliotheek staat
// af zoals het daar staat, niet zoals het in het project is meegegeven; alleen in de projectkopie was de actie dus onzichtbaar.
// Geeft true als het bestand is aangepast. Een lied met al een eigen stijlwissel (of zonder dia's) blijft ongemoeid.
export async function ensureRevertStyleInShowFile(filePath: string, outputId: string, styleId: string): Promise<boolean> {
  const raw = JSON.parse(await fs.readFile(filePath, 'utf-8'));
  if (!Array.isArray(raw) || !raw[1]) return false;
  const updated = withRevertStyleAction(raw[1], outputId, styleId);
  if (updated === raw[1]) return false;
  updated.timestamps = { ...(updated.timestamps || {}), modified: Date.now() };
  raw[1] = updated;
  // Via tijdelijk bestand en hernoemen: sommige showbestanden zijn van een andere gebruiker op de NFS-schijf
  const tmp = path.join(path.dirname(filePath), `.ark-tmp-${crypto.randomBytes(4).toString('hex')}`);
  await fs.writeFile(tmp, JSON.stringify(raw, null, 2));
  await fs.chmod(tmp, 0o666).catch(() => {});
  await fs.rename(tmp, filePath);
  return true;
}
