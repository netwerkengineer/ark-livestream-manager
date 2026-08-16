# Ark Church Livestream Manager

**v2.2.0** - Een all-in-one livestream management applicatie voor kerkdiensten, gebouwd met Next.js 16.

Deze applicatie centraliseert alle aspecten van livestream productie: van het genereren van presentaties en thumbnails tot het aansturen van lichtshows, LED-borden en OBS stream control. Speciaal ontwikkeld voor Ark Church om de gehele technische workflow van een livestream te stroomlijnen.

---

## Functies

### Broadcast Control
- **OBS Remote Control** - Start/stop streams, switch scenes, control audio inputs
- **YouTube Live Integration** - Automatisch plannen, titel/beschrijving beheren, thumbnails uploaden
- **Live Stream Monitor** - Real-time statistieken (bitrate, FPS, viewer count, chat berichten)
- **LED Sign Board Control** - Automatische "ON AIR" indicator via SSH (YouTube of OBS trigger)

### Content Generatie
- **Thumbnail Generator** - Maak custom thumbnails met afbeelding upload en tekst overlay
- **FreeShow Show Generator** - Genereer FreeShow presentaties vanuit Bijbelteksten (BGT, HSV, NBV21)
- **Scripture Search** - Zoek en synchroniseer Bijbelteksten met fuzzy matching

### Hardware Integraties
- **QLC+ DMX Lighting** - Volledig remote control via OSC en WebSocket
  - Scene selection, fade controls, preset management
  - Support voor Enttec DMX USB Pro interface
- **Bitfocus Companion** - Integratie voor Stream Deck control surfaces
- **RTP-MIDI** - MIDI control voor externe hardware

### System Management
- **Backup & Restore** - Automatische backups van configuraties:
  - App settings en tokens
  - QLC+ lighting scenes
  - Bitfocus Companion setup
  - FreeShow shows, Bibles en projecten (optioneel incl. media)
- **Multi-User Auth** - Next-Auth met YouTube OAuth en basic auth
- **Settings Wizard** - Guided setup voor eerste configuratie

---

## Tech Stack

- **Framework**: Next.js 16.2 (App Router) met React 19
- **Styling**: Tailwind CSS + Framer Motion animaties
- **Authentication**: NextAuth.js v5 (YouTube OAuth)
- **Real-time**: WebSockets (ws), Server-Sent Events
- **Video**: FFmpeg, ytdl-core, play-dl
- **Protocols**: OSC (node-osc), WebDAV, IMAP, FTP
- **Deployment**: Docker (multi-stage build voor Synology NAS)

---

## Hardware Vereisten

### Aanbevolen Setup
- **Productie Server**: Synology NAS met Container Manager (Docker)
- **OBS Machine**: Mac/PC met OBS Studio + WebSocket plugin (v5.0+)
- **Lighting Controller**: QLC+ (v4.12+) op Mac/Linux/Raspberry Pi
- **DMX Interface**: Enttec DMX USB Pro (of compatibel)
- **Optional**: Stream Deck met Bitfocus Companion

### Netwerk
- Alle systemen moeten op hetzelfde netwerk zijn (of via VPN)
- Poorten: 3000 (web), 4455 (OBS), 9999 (QLC+), 8000 (Companion)

---

## Installatie

### Lokale Development

1. **Clone en installeer dependencies:**
```bash
git clone <repository>
cd livestream-manager
npm install
```

2. **Configureer environment variabelen:**
```bash
cp .env.example .env.local
# Vul in: NEXTAUTH_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
```

3. **Start development server:**
```bash
npm run dev
```

4. **Open browser:**
```
http://localhost:3000
```

De setup wizard verschijnt automatisch bij eerste gebruik.

### Productie (Synology NAS)

Voor gedetailleerde NAS installatie instructies, zie [NAS_INSTALL.md](./NAS_INSTALL.md).

**Snelle Deployment:**
```bash
python3 deploy_nas.py
```

Dit script:
- Bouwt de Next.js app
- Pakt alles in een tarball
- Upload naar NAS via SSH
- Bouwt en start de Docker container

---

## Configuratie

### API Keys (vereist)

1. **YouTube Data API v3**
   - Ga naar [Google Cloud Console](https://console.cloud.google.com)
   - Maak een OAuth 2.0 Client ID
   - Scopes: `youtube.force-ssl`, `youtube.readonly`, `youtube.upload`

2. **NextAuth Secret**
   ```bash
   openssl rand -base64 32
   ```

### Hardware Configuratie

#### OBS WebSocket
```json
{
  "obsHost": "192.0.2.100",
  "obsPort": 4455,
  "obsPassword": "your-websocket-password"
}
```

#### QLC+ DMX
```json
{
  "qlcHost": "192.0.2.101",
  "qlcPort": 9999,
  "oscPort": 7700
}
```

#### LED Sign Board (via SSH)
```json
{
  "ledPanelEnabled": true,
  "ledHost": "192.0.2.102",
  "sshUser": "pi",
  "ledPanelMac": "AA:BB:CC:DD:EE:FF",
  "ledTriggerSource": "youtube",
  "ledActiveText": "LIVESTREAM ON AIR",
  "ledActiveColor": "#ff0000"
}
```

Alle settings configureer je via de UI (Settings pagina) of handmatig in `data/settings.json`.

---

## Project Structuur

```
livestream-manager/
├── src/
│   ├── app/                    # Next.js App Router pages
│   │   ├── api/                # API routes (REST & WebSocket)
│   │   │   ├── obs/            # OBS control endpoints
│   │   │   ├── qlc/            # QLC+ lighting control
│   │   │   ├── youtube/        # YouTube API proxy
│   │   │   └── freeshow/       # FreeShow show generation
│   │   └── page.tsx            # Main dashboard
│   ├── components/             # React components
│   │   ├── ThumbnailEditor.tsx
│   │   ├── StreamMonitor.tsx
│   │   ├── FreeshowGenerator.tsx
│   │   ├── LightsControl.tsx
│   │   └── BroadcastControlCenter.tsx
│   └── lib/                    # Utilities & managers
│       ├── obsManager.ts       # OBS WebSocket singleton
│       ├── settingsStore.ts    # Persistent settings
│       └── tokenStore.ts       # OAuth token management
├── scripts/                    # Development utilities
├── config/                     # QLC+ workspace files
├── data/                       # Runtime data (gitignored)
│   ├── settings.json
│   ├── tokens.json
│   └── backups/
├── Dockerfile                  # Production container
└── docker-compose.yml          # Local development stack
```

---

## Development Scripts

Zie [scripts/README.md](./scripts/README.md) voor documentatie van development utilities.

---

## Beveiliging

### Toegangsbeheer
- Alle API routes zijn beschermd met Next-Auth middleware
- Verschillende autorisatie levels: `admin`, `freeshow`, `viewer`
- YouTube tokens worden veilig opgeslagen met refresh mechanism

### Command Injection Preventie
- Alle SSH/shell commando's gebruiken `spawn()` met array arguments
- User input wordt gesanitizeerd met whitelist regex
- Geen string interpolatie in `exec()` calls

### Network
- OBS WebSocket gebruikt plain WS (geen TLS) - draai achter reverse proxy voor HTTPS
- API endpoints gebruiken CORS headers voor toegangscontrole

---

## Troubleshooting

### OBS verbinding lukt niet
1. Check of WebSocket plugin (v5.0+) is geïnstalleerd in OBS
2. Verifieer host/port in Settings
3. Test verbinding: `wscat -c ws://OBS_HOST:4455`

### QLC+ reageert niet
1. Check of QLC+ Web Interface draait (poort 9999)
2. Verifieer OSC output in QLC+ (Tools > OSC I/O Configuration)
3. Test: `python3 scripts/test_ws.py`

### YouTube upload faalt
1. Ververs OAuth token via Settings > YouTube > Re-authenticate
2. Check quota limits in Google Cloud Console
3. Verifieer dat alle scopes zijn toegekend

### LED Sign Board update niet
1. Check SSH toegang: `ssh user@LED_HOST`
2. Verifieer dat `led_control.py` bestaat op remote machine
3. Check logs voor SSH errors in Container logs

---

## Licentie

Proprietary - Ark Church

---

## Credits

Ontwikkeld voor Ark Church
Versie 2.2.0 (Augustus 2026)
