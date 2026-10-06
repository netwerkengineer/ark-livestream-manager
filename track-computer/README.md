# Track-computer (Tracks-tab)

Software voor de Mac die met REAPER de MultiTracks-stems afspeelt. De livestream-manager
bedient hem via REAPER's webinterface (Tracks-tab en de podiumweergave `/tracks`).

| Bestand | Waar op de track-computer | Wat |
|---|---|---|
| `mt2reaper.py` | `~/Tracks/_tools/` | Zet een MultiTracks-download (zip of map) om naar een REAPER-project: stems in 8 bussen, tempomap, secties als regions. `.m4a`-stems worden met `afconvert` naar WAV omgezet. Maakt ook een eigen click (stems *Click 1/4*, *1/8*, *1/16*, uit de tempomap, met de tikken uit de originele click); de originele click staat standaard gemute, net als 1/8 en 1/16. Bestaand project: `--add-click <songmap>`. |
| `song.example.json` | (voorbeeld) | Beschrijving van een eigen opname: titel, toonsoort, tempo, maatsoort en secties in maten. Zip dit samen met de stems (WAV/M4A, allemaal vanaf het begin van het nummer) en upload de zip. `mt2reaper.py <map> --check` laat vooraf zien wat er uitgelezen wordt. Zonder `.als` is dit de enige beschrijving die nodig is. |
| `busses.example.json` | `~/Tracks/_tools/busses.json` | Busindeling (welke stem naar welke uitgang), `freeshow.midi_hw_out_index` = MIDI-uitgang voor FreeShow in REAPER. |
| `convert-all.command` | `~/Tracks/_tools/` | Dubbelklikbaar: alles in `~/Tracks/Songs` omzetten. |
| `ark_tracks_agent.py` | `~/Tracks/_tools/` | Haalt geüploade tracks van de server op, zet ze om, en houdt alleen de audio van songs die nodig zijn (setlists, recent, "altijd houden"). |
| `ark_tracks_bridge.lua` | `~/Library/Application Support/REAPER/Scripts/` | Draait in REAPER: songs/setlist als projecttabs, muzikaal springen (regions), loop, dynamische guide, uitgangsmodus, FreeShow-cues. |
| `__startup.lua` | idem | Start de bridge automatisch met REAPER. |
| `ArkPads.swift` | `~/Tracks/_tools/` | Padspeler los van REAPER (crossfade per toonsoort). Pads in `~/Tracks/Pads/<set>/<laag>/<toon>.wav`. |

## Installatie (kort)

1. REAPER installeren; Settings → Control/OSC/web → *Web browser interface* op poort 8080.
2. Bestanden op hun plek zetten (tabel hierboven), `busses.example.json` kopiëren naar `busses.json`.
3. REAPER herstarten: de bridge start via `__startup.lua`.
4. Agent: in de app (Instellingen → Tracks) een agent-token maken en op de track-computer
   `~/Tracks/_tools/agent.json` aanmaken: `{"server": "https://<adres van de app>", "token": "<token>"}`.
   Starten als launchd-agent met `RunAtLoad`/`KeepAlive` op
   `/Library/Developer/CommandLineTools/usr/bin/python3 ~/Tracks/_tools/ark_tracks_agent.py`.
5. Padspeler: `swiftc -O -o ~/Tracks/_tools/ArkPads ArkPads.swift`, ook als launchd-agent starten.
6. In de app: Instellingen → Tracks (REAPER) aanzetten met het IP van de track-computer.

Een nieuwe versie van de bridge laden zonder REAPER te herstarten: de opdracht `reload`
(`SET/EXTSTATE/ArkTracks/cmd/<id>%09reload` via de webinterface).
