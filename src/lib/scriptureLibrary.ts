import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

// De bijbelshows van een project (categorie "scripture") ook in de showmap zetten. FreeShow zet een show uit een project bij het
// eerste openen in zijn bibliotheek; bij een opnieuw gemaakt project hebben ze hetzelfde id, dus FreeShow speelt dan de
// bibliotheekversie af en negeert een nieuwe stijl (bijv. Modern -> Ark). Door het bestand hier te vervangen (met een nieuwe
// timestamps.modified) wint de nieuwe versie in de sync en staat hij bij het volgende openen in de bibliotheek.
export async function writeScriptureShowsToLibrary(dataJson: any, showsDir: string): Promise<number> {
  let n = 0;
  for (const [id, show] of Object.entries<any>(dataJson?.shows || {})) {
    if (show?.category !== 'scripture' || !show?.name) continue;
    const name = String(show.name);
    if (/[\\/]/.test(name)) continue;
    const content = { ...show, timestamps: { ...(show.timestamps || {}), modified: Date.now() } };
    const target = path.join(showsDir, `${name}.show`);
    // Via tijdelijk bestand en hernoemen: sommige showbestanden zijn van een andere gebruiker op de NFS-schijf
    const tmp = path.join(showsDir, `.ark-tmp-${crypto.randomBytes(4).toString('hex')}`);
    await fs.writeFile(tmp, JSON.stringify([id, content]));
    await fs.chmod(tmp, 0o666).catch(() => {});
    await fs.rename(tmp, target);
    n++;
  }
  return n;
}
