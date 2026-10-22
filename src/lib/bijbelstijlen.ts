// Opmaak en achtergrond van de bijbeltekst-dia's. Per dienst (setlist) is een stijl te kiezen; "klassiek" is de standaard.
//
// Elke stijl is een achtergrondvideo (<FreeShow-map>/Media/Motion backgrounds/Ark Visuals/bijbel-<slug>.mp4, gemaakt met
// scripts/visuals/make_scripture_visual.py) plus de indeling van de tekstvakken op een dia van 1920x1080. De getallen hieronder
// (vakgrootte, lettergrootte, tekenbreedte) worden ook gebruikt om te schatten hoeveel verzen op één dia passen.

export interface BijbelStijl {
  slug: string;
  naam: string;
  omschrijving: string;
  /** voorbeeldkleuren voor de keuzelijst (achtergrond links/boven, accent/tekst rechts) */
  kleur: string;
  accent: string;
  /** bestandsnaam (zonder .mp4) in Ark Visuals */
  video: string;
  /** hoofdvak met de verzen */
  tekst: {
    vak: string;            // CSS van het tekstvak (positie, grootte, vlak, rand)
    vakB: number;           // breedte en hoogte in px, zonder opvulling (voor de schatting)
    vakH: number;
    uitlijning: 'left' | 'center';
    lettertype: string;
    grootte: number;        // px
    regelhoogte: number;    // factor
    tekenbreedte: number;   // gemiddelde tekenbreedte in "em" (voor de schatting)
    kleur: string;
    gewicht: string;
    schaduw: string;
  };
  nummer: { kleur: string; grootte: number };
  /** verwijzing (bv. "Johannes 3:16") en vertaling */
  verwijzing: { vak: string; uitlijning: 'left' | 'center' | 'right'; lettertype: string; grootte: number; kleur: string; stijl: string };
  vertaling: { vak: string; uitlijning: 'left' | 'center' | 'right'; lettertype: string; grootte: number; kleur: string };
  /** losse vlakjes (lijntjes, balk) als lege tekstvakken met een achtergrondkleur */
  decor: string[];
}

const SERIF = "Georgia, 'Times New Roman', serif";
const SANS = "CMGSans, Avenir, Arial, sans-serif";

export const BIJBELSTIJLEN: BijbelStijl[] = [
  {
    slug: 'klassiek',
    naam: 'Klassiek',
    omschrijving: 'Warm kaarslicht, gecentreerde tekst in een schreefletter met gouden accenten',
    kleur: '2a1a0c', accent: 'e8c27a',
    video: 'bijbel-klassiek',
    tekst: {
      vak: 'top:130px;left:210px;width:1500px;height:690px;', vakB: 1500, vakH: 690,
      uitlijning: 'center', lettertype: SERIF, grootte: 70, regelhoogte: 1.38, tekenbreedte: 0.5,
      kleur: 'rgb(255 246 230)', gewicht: 'normal', schaduw: '0px 2px 14px rgb(0 0 0 / 0.55)'
    },
    nummer: { kleur: 'rgb(232 194 122)', grootte: 36 },
    verwijzing: { vak: 'top:872px;left:360px;width:1200px;height:70px;', uitlijning: 'center', lettertype: SERIF, grootte: 46, kleur: 'rgb(232 194 122)', stijl: 'letter-spacing:0.14em;text-transform:uppercase;' },
    vertaling: { vak: 'top:945px;left:360px;width:1200px;height:50px;', uitlijning: 'center', lettertype: SANS, grootte: 32, kleur: 'rgb(255 246 230 / 0.6)' },
    decor: ['top:852px;left:840px;width:240px;height:2px;background-color:rgb(232 194 122);']
  },
  {
    slug: 'modern',
    naam: 'Modern',
    omschrijving: 'Diep nachtblauw, tekst links in een schreefloos lettertype met blauwe balk',
    kleur: '0a1632', accent: '9fc0ff',
    video: 'bijbel-modern',
    tekst: {
      vak: 'top:130px;left:230px;width:1460px;height:700px;', vakB: 1460, vakH: 700,
      uitlijning: 'left', lettertype: SANS, grootte: 72, regelhoogte: 1.3, tekenbreedte: 0.52,
      kleur: 'rgb(255 255 255)', gewicht: 'bold', schaduw: '0px 2px 16px rgb(0 0 0 / 0.5)'
    },
    nummer: { kleur: 'rgb(159 192 255)', grootte: 34 },
    verwijzing: { vak: 'top:870px;left:230px;width:1300px;height:70px;', uitlijning: 'left', lettertype: SANS, grootte: 44, kleur: 'rgb(159 192 255)', stijl: 'letter-spacing:0.18em;text-transform:uppercase;font-weight:bold;' },
    vertaling: { vak: 'top:945px;left:230px;width:1300px;height:50px;', uitlijning: 'left', lettertype: SANS, grootte: 32, kleur: 'rgb(255 255 255 / 0.55)' },
    decor: ['top:150px;left:170px;width:8px;height:660px;background-color:rgb(143 176 242);border-radius:4px;']
  },
  {
    slug: 'kader',
    naam: 'Kader',
    omschrijving: 'Donkere leisteen met een zacht, doorschijnend kader en gouden rand',
    kleur: '161b20', accent: 'ffd98a',
    video: 'bijbel-kader',
    tekst: {
      vak: 'top:110px;left:150px;width:1620px;height:730px;padding:60px 80px;background-color:rgb(10 12 16 / 0.46);border:2px solid rgb(255 226 168 / 0.35);border-radius:26px;',
      vakB: 1620 - 160, vakH: 730 - 120,
      uitlijning: 'left', lettertype: SERIF, grootte: 66, regelhoogte: 1.4, tekenbreedte: 0.5,
      kleur: 'rgb(255 250 240)', gewicht: 'normal', schaduw: '0px 2px 12px rgb(0 0 0 / 0.5)'
    },
    nummer: { kleur: 'rgb(255 217 138)', grootte: 32 },
    verwijzing: { vak: 'top:880px;left:150px;width:1000px;height:80px;', uitlijning: 'left', lettertype: SERIF, grootte: 50, kleur: 'rgb(255 217 138)', stijl: 'font-style:italic;' },
    vertaling: { vak: 'top:895px;left:1170px;width:600px;height:60px;', uitlijning: 'right', lettertype: SANS, grootte: 32, kleur: 'rgb(255 250 240 / 0.6)' },
    decor: []
  },
  {
    slug: 'licht',
    naam: 'Licht',
    omschrijving: 'Lichte crème-achtergrond met zonnebundel en donkere tekst',
    kleur: 'ecdcbc', accent: '7a4e0e',
    video: 'bijbel-licht',
    tekst: {
      vak: 'top:130px;left:210px;width:1500px;height:690px;', vakB: 1500, vakH: 690,
      uitlijning: 'center', lettertype: SERIF, grootte: 70, regelhoogte: 1.38, tekenbreedte: 0.5,
      kleur: 'rgb(42 27 13)', gewicht: 'normal', schaduw: 'none'
    },
    nummer: { kleur: 'rgb(154 101 18)', grootte: 36 },
    verwijzing: { vak: 'top:872px;left:360px;width:1200px;height:70px;', uitlijning: 'center', lettertype: SERIF, grootte: 46, kleur: 'rgb(122 78 14)', stijl: 'letter-spacing:0.14em;text-transform:uppercase;' },
    vertaling: { vak: 'top:945px;left:360px;width:1200px;height:50px;', uitlijning: 'center', lettertype: SANS, grootte: 32, kleur: 'rgb(42 27 13 / 0.6)' },
    decor: ['top:852px;left:840px;width:240px;height:2px;background-color:rgb(154 101 18);']
  }
];

export const STANDAARD_BIJBELSTIJL = 'klassiek';

export function getBijbelStijl(slug?: string | null): BijbelStijl {
  return BIJBELSTIJLEN.find(s => s.slug === slug) || BIJBELSTIJLEN.find(s => s.slug === STANDAARD_BIJBELSTIJL)!;
}

export function isBijbelStijl(slug: unknown): slug is string {
  return typeof slug === 'string' && BIJBELSTIJLEN.some(s => s.slug === slug);
}

/** Hoeveel tekens passen op een regel en hoeveel regels op een dia (schatting, zie draftProjectGenerator.groupVersesForSlides). */
export function bijbelCapaciteit(stijl: BijbelStijl): { tekensPerRegel: number; regelsPerDia: number } {
  const t = stijl.tekst;
  return {
    tekensPerRegel: Math.floor(t.vakB / (t.grootte * t.tekenbreedte)),
    regelsPerDia: Math.floor(t.vakH / (t.grootte * t.regelhoogte))
  };
}
