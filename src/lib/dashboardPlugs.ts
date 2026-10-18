// Dashboardknoppen die een pc starten/stoppen via zijn slimme stekker (knop-id -> stekker-id).
// Zo'n knop bedient de stekker rechtstreeks via het interne script (/api/tuya/power) en kiest zelf aan/uit op basis van de echte stand van
// de stekker; Companion wordt voor deze knoppen niet gebruikt. Een eigen `plugId` bij de knop (instellingen) gaat voor.
export const DEFAULT_PLUG_BY_BUTTON: Record<string, string> = {
  qww7gkpem: "plug_obs",                    // "OBS PC"
  qj3e7j7tu: "plug_beamer",                 // "Beamer PC"
  "722r2rj1r": "plug_offgridtec_mac_mini",  // "Ark Tracks" (Mac mini): afsluiten = apps stoppen, slaapstand, stekker uit; aan = stekker aan
};

export function plugIdForButton(button: { id?: string; plugId?: string } | null | undefined): string | null {
  if (!button) return null;
  return (button.plugId && button.plugId.trim()) || (button.id ? DEFAULT_PLUG_BY_BUTTON[button.id] : undefined) || null;
}
