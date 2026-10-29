import { DraftService, updateSongInDraft } from '@/lib/draftServicesStore';
import { getLocalShowFilePath } from '@/lib/songs';
import { readCurrentKeuze } from '@/lib/sfeer';

// Een lied dat in de setlist komt en al een sfeer heeft op de show (de laatste keer gekozen) krijgt die sfeer meteen in
// de bouwer te zien, zodat je alleen hoeft te kiezen als je wilt afwijken. De waarde wordt bij het lied in de concept-
// setlist bewaard; "Project aanmaken" zet dezelfde sfeer daarna opnieuw op de show (dat is dan geen verandering).
export async function fillCurrentSfeer(draft: DraftService): Promise<DraftService> {
  let result = draft;
  for (const song of draft.songs) {
    if (song.sfeer || song.achtergrond) continue;
    try {
      const showFile = await getLocalShowFilePath(song.title, song.artist || '');
      if (!showFile) continue;
      const keuze = await readCurrentKeuze(showFile);
      if (!keuze.sfeer && !keuze.achtergrond) continue;
      result = updateSongInDraft(draft.serviceDate, song.id, { sfeer: keuze.sfeer, achtergrond: keuze.achtergrond }) || result;
    } catch { /* geen of onleesbaar showbestand: het lied blijft zonder sfeer in de bouwer */ }
  }
  return result;
}
