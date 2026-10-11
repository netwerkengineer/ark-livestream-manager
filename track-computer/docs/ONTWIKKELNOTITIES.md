# Ontwikkelnotities Ark Tracks (Mac, Linux, Windows)

Technische valkuilen die niet uit de code blijken. Bewust zonder adressen, gebruikersnamen of sleutels: deze repo is openbaar.
Wat bij jullie opstelling hoort (IP-adressen, accounts, wachtwoorden) staat in je eigen, privé notities of wachtwoordmanager.

## Opbouw
- `ark-player/` en `ark-desktop/`: de Mac-app (Swift). `ark-engine/`: dezelfde speler in Rust voor Linux en Windows (`ark-tracks`, `ark-engine-cli`, `ark-engine-play`).
- De app laadt de pagina `/desktop` van de webapp. De pagina praat met de speler via `window.arkEngine.call(pad, params)`.
- Bouwen (Linux): `cargo build --release --locked --features app`; pakket: `cargo deb --no-build`. De binary `ark-tracks` heeft de feature `app`; zonder die feature bouwt alleen de CLI.
- Windows/Linux-bouwen kan ook via GitHub Actions (`.github/workflows/ark-tracks-*.yml`).
- Handige omgevingsvariabelen: `ARK_START_URL` (eigen pagina openen, bv. `ark://localhost/settings`), `ARK_VAULT_DISABLE`, `ARK_MIRROR_DIR`, `ARK_PLAYER_CONFIG`, `ARK_LOG`, `ARK_PRINT_INIT=1` (init-script tonen om met `node --check` te controleren).

## Een Mac die zelf opstart en inlogt (onbemande opstelling)
- Een Mac die echt is **afgesloten** start niet zelf op als de stroom terugkomt (`pmset autorestart` geldt alleen voor stroomuitval terwijl hij aan stond) en Wake-on-LAN werkt niet vanuit een volledige shutdown. Daarom stopt `shutdown_pcs.py` voor een Mac de apps, doet `sync` en `pmset sleepnow`, en schakelt daarna de stekker uit.
- Auto-login laat de login-Keychain **vergrendeld**. De Mac-app gebruikt de Keychain zonder vraag en bewaart zijn geheimen ook in `~/Library/Application Support/ArkTracks/vault.json` (rechten 0600).
- Schermdeling met gebruikersnaam en wachtwoord kan falen door het SRP-inlogproces. Een legacy VNC-wachtwoord werkt dan wel (viewer met `-SecurityTypes VncAuth`, bv. TigerVNC). Zet dat wachtwoord weer uit als het niet meer nodig is en gebruik het alleen via een VPN.

## FreeShow en cues
- De app praat met de REST-listener van FreeShow (`action` en `data` als query). Dat is de WebSocket-poort + 1.
- Een nummer heeft een cuetabel `<project>.RPP.cues` nodig (show-id, indelings-id en per sectie de dia's). De tabel maak je in de Tracks-tab (knop *Tekst*, daarna *Timing opnemen*).
- De cue-index telt **uitgeklapte** dia's (hoofddia plus kinderen) van de indeling "Tracks". Klopt het aantal in de indeling niet met de tabel, dan werken alleen de eerste dia's.
- De FreeShow-synchronisatie werkt in **twee richtingen, de nieuwste wijzigingstijd wint**. Een draaiende FreeShow kan een net opgeslagen indeling overschrijven. Volgorde na een Tekst-koppeling: FreeShow sluiten, Tekst opslaan, synchroniseren, FreeShow starten.

## REAPER-bridge (`ark_tracks_bridge.lua`)
Voor cues naar FreeShow heeft de bridge alle drie nodig:
1. een project met **regions** (de actuele `mt2reaper.py` schrijft die; oudere versies schreven gewone markers);
2. een MIDI-hardware-uitgang op de track "FreeShow MIDI" (`freeshow.midi_hw_out_index` in `busses.json` mag niet -1 zijn);
3. een cuetabel naast het project.

Opdrachten gaan via de webinterface van REAPER (poort 8080): `SET/EXTSTATE/ArkTracks/cmd/<id>\t<opdracht>\t<arg>` (urlencoded), status via `GET/EXTSTATE/ArkTracks/state`.

MultiTracks levert stems soms als `.m4a`. REAPER op Linux kan AAC niet lezen: `mt2reaper` zet ze om naar WAV (`afconvert`, `ffmpeg` of `ark-engine-cli decode`) en neemt de lengte uit de WAV.

## Linux/Windows-specifiek
- Linux: een oude losse kopie in `~/.local/bin` wordt eerder gevonden dan `/usr/bin/ark-tracks`; verwijder die na een installatie van het pakket.
- Een nummer dat niet in het vrije geheugen past wordt geweigerd met een melding (geen vastlopen). 3 GB voor 26 stems is gewoon.
- Menubalk en Instellingen: Ark Tracks, Weergave, Help. Eigen pagina's draaien op `ark://localhost` (Linux/Mac) of `https://ark.localhost` (Windows).
- Windows: crt-statisch bouwen (`.cargo/config.toml`), pictogram via `build.rs`, installer met WiX 3.14 (`wix/main.wxs`).

## Deployen van de webapp
- `deploy_nas.py` vraagt het wachtwoord één keer; er staat nergens een wachtwoord in een opdrachtregel. Gebruik bij voorkeur een SSH-sleutel.
- Houd het archief klein: sluit `track-computer/ark-engine/target` en `track-computer/ark-desktop/build` uit (staat al in het script en `.dockerignore`).
- Een NAS met weinig geheugen kan een volledige `next build` tot een uur laten duren; breek niet af.
- `data/` is van de container (uid 1001), niet wereld-leesbaar; de SSH-sleutels in `data/` horen 600 te zijn.

## Controleren zonder te klikken
- Linux/Windows: eigen pagina's openen met `ARK_START_URL` en een screenshot maken; de lokale bediening testen met `curl -k` op de https-poort.
- Mac mini of andere afstandscomputer: SSH voor logbestanden, `pgrep`, `lsof`; schermafbeelding via SSH lukt niet (geen schermtoegang).
