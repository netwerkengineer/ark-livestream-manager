import fs from 'fs/promises';
import path from 'path';

// Styles sync between environments via Config/settings_synced.json (unlike
// outputs, which are local per-machine), so a style can be looked up by its
// stable name here instead of a hardcoded ID that would only be valid on
// whichever machine it was copied from.
export async function resolveStyleIdByName(freeshowPath: string | undefined, styleName: string): Promise<string | null> {
  if (!freeshowPath) return null;
  try {
    const configPath = path.join(freeshowPath, 'Config', 'settings_synced.json');
    const raw = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(raw);
    const styles = config.styles || {};
    for (const [sid, s] of Object.entries<any>(styles)) {
      if (s?.name === styleName) return sid;
    }
  } catch (err) {
    console.error(`[FreeShow] Kon stijl "${styleName}" niet opzoeken:`, err);
  }
  return null;
}

export const LIVESTREAM_VIDEO_STYLE_NAME = 'Livestream Video fullscreen';
export const LIVESTREAM_SONG_STYLE_NAME = 'Livestream Liederen';
