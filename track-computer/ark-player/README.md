# ark-player (prototype)

Eigen multitrack-speler voor de tracks-computer, als mogelijke vervanger van REAPER (alleen macOS voor nu).
Stand: **stap 2 van 5**. Draait naast REAPER; raakt REAPER, de bridge en de agent niet aan.

## Wat het nu kan (stap 2, 2 kanalen eerst)
- Een song-map laden (`song.json` + stems) en alle stems in het geheugen zetten (ca. 1 GB per nummer). Eigen Click-stems
  (`Ark Click 1-4/1-8/1-16.wav`) worden meegeladen (standaard gemute, zoals mt2reaper). LIVE-stems (drums*, bass, keys, piano 1*, eg 1*) staan bij het laden gemute.
- **Uitgangsmodi zoals de bridge:** `stereo` (alles naar 1+2), `2ch` (click+guide mono naar 1, -3 dB; de rest mono naar 2),
  `3ch` (click+guide mono naar 1, tracks stereo naar 2+3), `multi` (8 bussen) en `auto`. Met te weinig uitgangen valt de modus terug (3ch -> 2ch -> stereo).
- Start, pauze, stop, zoeken, mute en volume per stem, mastervolume, niveaumeters.
- **Secties en sprongen**, sample-nauwkeurig met een korte fade (geen klik): `jump?id=&mode=end|bar|now`, standaardmodus via `mode?m=`, plan annuleren met `cancel`.
- **Loop** van de huidige sectie (`loop?on=1|0`); een sprong stopt de loop.
- **Guide-aankondiging bij een sprong of loop:** de guide-stem in de laatste twee maten voor het sprongmoment wordt vervangen door de originele
  aankondiging van de doelsectie (zoals `prepareGuide` in de bridge); te laat voor de hele cue -> alleen dempen.
- Lokale HTTP-API op 127.0.0.1 (poort 8099): `/state /load?path= /play /pause /stop /seek?t= /jump /loop /cancel /mode /output?mode= /mute /gain /master`.

## Speelbestand `ark-player.json`
`mt2reaper.py` schrijft sinds 9 okt 2026 naast het RPP een `ark-player.json` (voor MultiTracks-zips en eigen opnames, ook voor bestaande nummers als je de map opnieuw door mt2reaper haalt):
stems (bestand, naam, startpositie, standaard-mute), secties in seconden, tempo en maatsoort in kwartnoten (dus tempo- en maatwissels zoals bij MultiTracks).
De speler gebruikt dit bestand als het er is, anders `song.json`. Het RPP blijft gewoon bestaan, REAPER werkt dus ongewijzigd.

## Gebruik
```
./build.sh
./ark-player devices
./ark-player selftest <songmap> [start-sec] [duur-sec] [--mode stereo|2ch|3ch|multi]   # offline mixen, geen geluid
./ark-player jumptest <songmap> <vanaf-sec> <sectie-id> [end|bar|now] [--loop]          # offline sprongtest
./ark-player serve [--port 8099] [--device "NAAM"] [--mode 2ch] [--master-db -6] [songmap]
```
Zet het mastervolume bij een eerste luistertest laag (`--master-db -24`). Met `ARK_GUIDE_CHECK=1` controleert `jumptest` het guide-venster sample voor sample.

## Bekende verschillen en open punten
- Mono-downmix: een stereo-stem naar een mono-uitgang wordt gemiddeld ((L+R)/2). REAPER's eigen mono-send kan anders klinken (niveau); vergelijk dit met een echte song voordat je overstapt.
- Samplerate-omrekening (alles moet 48 kHz zijn), maatsoortwissels binnen een nummer en het verouderde `audioUnit`-onderdeel van macOS 27.
- Setlist/overgangen en FreeShow-cues (stap 3), adapter in de app (stap 4), stevig maken (stap 5).

## Gemeten (7 okt/9 okt 2026)
- MacBook Pro (M-chip): 16 stems, 274 s, 999 MB; laden 0,2 s; mixen gemiddeld 40 us per blok van 512 samples (10,7 ms beschikbaar).
- Mac mini M1 naar BlackHole 16ch, multi-modus: 16 stems, 282 s; mixen gemiddeld 81 us, max 0,7 ms; positie loopt gelijk met de klok.
- Stap 2 (9 okt 2026): sprongen exact op het geplande moment (verwacht = werkelijk tot op de ms) op MacBook en Mac mini; stap rond de sprong klein (max 0,013-0,04 t.o.v. gemiddeld 0,01); guide-venster sample voor sample gelijk aan de bronaankondiging; 2ch/3ch/multi/stereo gecontroleerd op uitgangssignalen.
